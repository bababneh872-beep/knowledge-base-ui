import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';

interface UploadResponse {
  documentId?: number;
  fileName?: string;
  chunkCount?: number;
  status?: string;
}

interface UploadQueueItem {
  id: string;
  file: File;
  status: 'Pending' | 'Processing' | 'Completed' | 'Failed';
  progress: number;
  chunkCount?: number;
  errorMessage?: string;
}

interface DocumentSummary {
  id: number;
  fileName: string;
  uploadDate: string;
  status: string;
  errorMessage?: string | null;
  chunkCount: number;
}

interface ChatResponse {
  conversationId: number;
  answer: string;
  sources: { fileName: string; chunkIndex: number }[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: { fileName: string; chunkIndex: number }[];
}

interface SavedConversation {
  conversationId: number;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
}

type AppView = 'dashboard' | 'documents' | 'chat' | 'settings';

@Component({
  selector: 'app-root',
  imports: [MarkdownModule],
  templateUrl: './app.html'
})
export class App implements OnInit {
  stopGenerating(): void {
  if (!this.chatLoading) {
    return;
  }

  this.chatSubscription?.unsubscribe();
  this.chatSubscription = null;

  this.chatLoading = false;
  this.chatError = 'تم إيقاف توليد الإجابة.';
  this.changeDetector.markForCheck();
}
  uploadItems: UploadQueueItem[] = [];
  isDragging = false;

  activeView: AppView = 'dashboard';
  sidebarOpen = false;
  documents: DocumentSummary[] = [];
  documentsLoading = false;
  documentsError = '';
  documentsNotice = '';
  documentsSearch = '';
  documentActionId: number | null = null;

  chatQuestion = '';
  chatMessages: ChatMessage[] = [];
  conversations: SavedConversation[] = [];
  chatLoading = false;
  chatError = '';
  private conversationId: number | null = null;
  private chatSubscription: Subscription | null = null;
  
  private readonly conversationsStorageKey = 'fieldnotes.conversations.v1';

  readonly uploadEndpoint = 'http://localhost:5115/api/documents/upload';

  constructor(
    private http: HttpClient,
    private changeDetector: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadDocuments();
    this.loadConversations();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onUpload(): void {
    if (this.isUploading) {
      return;
    }

    const pendingItems = this.uploadItems.filter(item => item.status === 'Pending');
    if (pendingItems.length === 0) {
      return;
    }
    

    this.documentsNotice = '';
    for (const item of pendingItems) {
      item.status = 'Processing';
      item.progress = 0;
      this.uploadFile(item);
    }
    this.changeDetector.markForCheck();
  }

  get isUploading(): boolean {
    return this.uploadItems.some(item => item.status === 'Processing');
  }

  get pendingUploadCount(): number {
    return this.uploadItems.filter(item => item.status === 'Pending').length;
  }

  removeUpload(id: string): void {
    const item = this.uploadItems.find(upload => upload.id === id);
    if (!item || item.status === 'Processing') {
      return;
    }

    this.uploadItems = this.uploadItems.filter(upload => upload.id !== id);
  }

  private addFiles(files: File[]): void {
  const additions = files.map((file, index): UploadQueueItem => {
    const extension = file.name
      .split('.')
      .pop()
      ?.toLowerCase();

    const isSupported = [
      'pdf',
      'png',
      'jpg',
      'jpeg'
    ].includes(extension ?? '');

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${index}`,
      file,
      status: isSupported ? 'Pending' : 'Failed',
      progress: 0,
      errorMessage: isSupported
        ? undefined
        : 'Only PDF, PNG, JPG, and JPEG files can be uploaded.'
    };
  });

  this.uploadItems = [...this.uploadItems, ...additions];
  this.changeDetector.markForCheck();
}

  private uploadFile(item: UploadQueueItem): void {
    const formData = new FormData();
    formData.append('file', item.file);

    this.http.post<UploadResponse>(this.uploadEndpoint, formData, {
      observe: 'events',
      reportProgress: true
    }).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total) {
            item.progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
          }
        } else if (event.type === HttpEventType.Response) {
          item.status = 'Completed';
          item.progress = 100;
          item.chunkCount = event.body?.chunkCount;
          this.documentsNotice = `${item.file.name} uploaded successfully.`;
          this.loadDocuments();
        }

        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        item.status = 'Failed';
        item.errorMessage = this.getUploadErrorMessage(error);
        this.changeDetector.markForCheck();
      }
    });
  }

  setView(view: AppView): void {
    this.activeView = view;
    this.sidebarOpen = false;
  }

  loadDocuments(): void {
    this.documentsLoading = true;
    this.documentsError = '';

    this.http.get<DocumentSummary[]>('http://localhost:5115/api/Documents').subscribe({
      next: (documents) => {
        this.documents = documents;
        this.documentsLoading = false;
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.documentsLoading = false;
        this.documentsError = this.getActionErrorMessage(error);
        this.changeDetector.markForCheck();
      }
    });
  }

  get filteredDocuments(): DocumentSummary[] {
    const search = this.documentsSearch.trim().toLowerCase();
    if (!search) {
      return this.documents;
    }

    return this.documents.filter(document => document.fileName.toLowerCase().includes(search));
  }

  get recentDocuments(): DocumentSummary[] {
    return this.documents.slice(0, 5);
  }

  get totalChunks(): number {
    return this.documents.reduce((total, document) => total + document.chunkCount, 0);
  }

  get processingCount(): number {
    return this.documents.filter(document => document.status === 'Processing').length;
  }

  get failedCount(): number {
    return this.documents.filter(document => document.status === 'Failed').length;
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  deleteDocument(document: DocumentSummary): void {
    if (!window.confirm(`Delete ${document.fileName}? This also removes its chunks.`)) {
      return;
    }

    this.documentActionId = document.id;
    this.documentsError = '';
    this.documentsNotice = '';
    this.http.delete(`http://localhost:5115/api/Documents/${document.id}`).subscribe({
      next: () => {
        this.documentsNotice = `${document.fileName} was deleted.`;
        this.documentActionId = null;
        this.loadDocuments();
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.documentActionId = null;
        this.documentsError = this.getActionErrorMessage(error);
        this.changeDetector.markForCheck();
      }
    });
  }

  retryDocument(document: DocumentSummary): void {
    this.documentActionId = document.id;
    this.documentsError = '';
    this.documentsNotice = '';
    this.http.post<UploadResponse>(`http://localhost:5115/api/Documents/${document.id}/retry`, {}).subscribe({
      next: () => {
        this.documentActionId = null;
        this.documentsNotice = `${document.fileName} was processed successfully.`;
        this.loadDocuments();
        this.changeDetector.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.documentActionId = null;
        this.documentsError = this.getActionErrorMessage(error);
        this.loadDocuments();
        this.changeDetector.markForCheck();
      }
    });
  }

  askSuggestedQuestion(question: string): void {
    this.chatQuestion = question;
    this.setView('chat');
    this.onAskChat();
  }

  onAskChat(): void {
  const question = this.chatQuestion.trim();

  if (!question || this.chatLoading) {
    return;
  }

  

  this.chatLoading = true;
  this.chatError = '';
  this.chatQuestion = '';

  this.chatMessages = [
    ...this.chatMessages,
    {
      role: 'user',
      content: question
    }
  ];

  this.chatSubscription = this.http
  .post<ChatResponse>(
    'http://localhost:5115/api/chat',
    {
      question,
      conversationId: this.conversationId
    }
  )
    .subscribe({
      next: (response) => {
        this.conversationId = response.conversationId;

        
this.chatMessages = [
  ...this.chatMessages,
  {
    role: 'assistant',
    content: (response.answer ?? '')
      .replace(/\s*\[S\d+\]/g, '')
      .replace(/\*\*/g, '')
      .trim(),
    sources: response.sources
  }
];

        this.saveCurrentConversation();

        this.chatLoading = false;
        this.changeDetector.markForCheck();
      },

      error: (error: HttpErrorResponse) => {
        console.error('Chat request failed:', error);

        this.chatError = this.getChatErrorMessage(error);

        this.chatLoading = false;
        this.changeDetector.markForCheck();
      }
    });
}

stopChat(): void {
  if (!this.chatLoading) {
    return;
  }

  this.chatSubscription?.unsubscribe();
  this.chatSubscription = null;

  this.chatLoading = false;
  this.changeDetector.markForCheck();
}

  startNewChat(): void {
    if (this.chatLoading) {
      return;
    }

    this.saveCurrentConversation();
    this.conversationId = null;
    this.chatMessages = [];
    this.chatQuestion = '';
    this.chatError = '';
  }

  openConversation(conversation: SavedConversation): void {
    if (this.chatLoading) {
      return;
    }

    this.saveCurrentConversation();
    this.conversationId = conversation.conversationId;
    this.chatMessages = [...conversation.messages];
    this.chatQuestion = '';
    this.chatError = '';
    this.activeView = 'chat';
    this.sidebarOpen = false;
  }

  isActiveConversation(conversation: SavedConversation): boolean {
    return this.conversationId === conversation.conversationId;
  }
  
deleteConversation(conversation: SavedConversation, event: MouseEvent): void {
  event.stopPropagation();

  if (this.chatLoading) {
    return;
  }

  const confirmed = window.confirm(
    `Delete "${conversation.title}"? This will permanently delete this conversation and its messages.`
  );

  if (!confirmed) {
    return;
  }

  this.chatError = '';

  this.http.delete(
    `http://localhost:5115/api/chat/${conversation.conversationId}`
  ).subscribe({
    next: () => {
      this.conversations = this.conversations.filter(
        item => item.conversationId !== conversation.conversationId
      );

      try {
        window.localStorage.setItem(
          this.conversationsStorageKey,
          JSON.stringify(this.conversations)
        );
      } catch {
        this.chatError = 'The conversation was deleted from the server, but the browser history could not be updated.';
      }

      if (this.conversationId === conversation.conversationId) {
        this.conversationId = null;
        this.chatMessages = [];
        this.chatQuestion = '';
      }

      this.changeDetector.markForCheck();
    },
    error: (error: HttpErrorResponse) => {
      this.chatError = this.getActionErrorMessage(error);
      this.changeDetector.markForCheck();
    }
  });
}

  formatConversationDate(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
  }

  private loadConversations(): void {
    try {
      const stored = window.localStorage.getItem(this.conversationsStorageKey);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as SavedConversation[];
      this.conversations = Array.isArray(parsed)
        ? parsed.filter(conversation =>
          Number.isInteger(conversation.conversationId)
          && Array.isArray(conversation.messages))
        : [];
    } catch {
      this.conversations = [];
    }
  }

  private saveCurrentConversation(): void {
    if (this.conversationId === null || this.chatMessages.length === 0) {
      return;
    }

    const firstQuestion = this.chatMessages.find(message => message.role === 'user')?.content ?? 'New conversation';
    const conversation: SavedConversation = {
      conversationId: this.conversationId,
      title: firstQuestion.length > 48 ? `${firstQuestion.slice(0, 48)}...` : firstQuestion,
      updatedAt: new Date().toISOString(),
      messages: [...this.chatMessages]
    };
    this.conversations = [
      conversation,
      ...this.conversations.filter(item => item.conversationId !== this.conversationId)
    ].slice(0, 20);

    try {
      window.localStorage.setItem(this.conversationsStorageKey, JSON.stringify(this.conversations));
    } catch {
      this.chatError = 'This conversation could not be saved in this browser.';
    }
  }

  private getUploadErrorMessage(error: HttpErrorResponse): string {
    if (error.status === 0) {
      return 'Could not reach the backend. Check that the API is running at localhost:5115 and allows requests from this app.';
    }

    if (
      typeof error.error === 'string' &&
      error.error.trim()
    ) {
      return error.error;
    }

    return (
      error.error?.message ??
      `Upload failed (HTTP ${error.status}). Please try again.`
    );
  }

  private getChatErrorMessage(error: HttpErrorResponse): string {
    if (error.status === 0) {
      return 'Could not reach the backend. Check that the API is running at localhost:5115.';
    }

    return error.error?.message ?? `Question failed (HTTP ${error.status}). Please try again.`;
  }

  private getActionErrorMessage(error: HttpErrorResponse): string {
    if (error.status === 0) {
      return 'Could not reach the backend. Check that the API is running at localhost:5115.';
    }

    const body = error.error as { message?: string; title?: string } | null;
    return body?.message ?? body?.title ?? `Request failed (HTTP ${error.status}). Please try again.`;
  }
}