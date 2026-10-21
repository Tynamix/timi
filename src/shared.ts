/** Platform-neutral application contract. All timestamps/durations are epoch/elapsed milliseconds. */
export type Locale = 'en' | 'de';
export type RecordKind = 'work' | 'break';
export interface Project { id: string; name: string; archived: boolean }
export interface TimeRecord { id: string; start: number; end: number; kind: RecordKind; projectId: string | null; source: 'manual' | 'tracked' | 'idle' | 'recovery' }
export interface RecordInput { start: number; end: number; kind: RecordKind; projectId: string | null }
/** Monday through Sunday; zero hours means a day off. */
export interface WorkGoals {
  dailyHours: number[]; notifyDaily: boolean; notifyWeekly: boolean;
  /** Absent in older preferences; defaults to displaying worked time. */
  showRemaining?: boolean;
}
export interface WorkGoalNotice { kind: 'day' | 'week'; period: string; targetMs: number; workedMs: number }
export interface Settings { idleMinutes: number; reminderMinutes: number; workGoals: WorkGoals }
export interface ActivePeriod { kind: RecordKind; start: number; projectId: string | null }
export interface PendingPeriod { id: string; start: number; end: number | null; projectId: string | null; reason: 'idle' | 'recovery'; resume: boolean }
export interface WeekReport {
  start: number; end: number; days: number[];
  rows: { projectId: string; name: string; archived: boolean; days: number[]; total: number }[];
  workDays: number[]; breakDays: number[]; workTotal: number; breakTotal: number;
}
export interface Snapshot {
  now: number; mode: 'work' | 'break' | 'untracked' | 'pending';
  active: ActivePeriod | null; pending: PendingPeriod | null; resumeProjectId: string | null;
  projects: Project[]; settings: Settings; records: TimeRecord[];
  todayMs: number; week: WeekReport; reminderDue: boolean; canPresent: boolean;
}
export type Command =
  | { type: 'start'; name: string }
  | { type: 'createProject'; name: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'later' }
  | { type: 'resolve'; choice: 'work' | 'break' | 'discard'; pendingId?: string; projectId?: string; projectName?: string }
  | { type: 'settings'; idleMinutes: number; reminderMinutes: number; workGoals?: WorkGoals }
  | { type: 'renameProject'; id: string; name: string }
  | { type: 'archiveProject'; id: string; archived: boolean }
  | { type: 'correct'; removeIds: string[]; records: RecordInput[] };
export interface NativeSample { idleMs: number; locked: boolean; sleeping: boolean }
export interface AppError { code: string; details?: Record<string, string | number> }
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
export type WorkspaceView = 'overview' | 'settings';
export type WindowKind = 'entry' | 'overview' | 'clarification';
export interface UpdateStatus {
  phase: 'disabled' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'installing' | 'restart' | 'error';
  version: string | null;
  error: AppError | null;
}
export interface Environment { locale: Locale; version: string; loginAvailable: boolean; launchAtLogin: boolean; launchAtLoginStatus: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found'; packaged: boolean }
export interface DesktopAPI {
  updateStatus(): Promise<Result<UpdateStatus>>;
  checkUpdate(): Promise<Result<UpdateStatus>>;
  installUpdate(): Promise<Result<UpdateStatus>>;
  onUpdate(callback: (status: UpdateStatus) => void): () => void;
  snapshot(weekOffset?: number): Promise<Result<Snapshot>>;
  command(command: Command): Promise<Result<Snapshot>>;
  environment(): Promise<Result<Environment>>;
  setLaunchAtLogin(enabled: boolean): Promise<Result<boolean>>;
  openWindow(view: WorkspaceView): Promise<Result<void>>;
  workspaceView(): Promise<Result<WorkspaceView>>;
  onNavigate(callback: (view: WorkspaceView) => void): () => void;
  closeWindow(): Promise<Result<void>>;
  quit(): Promise<Result<void>>;
  onChanged(callback: () => void): () => void;
  onError(callback: (error: AppError) => void): () => void;
  onFocus(callback: () => void): () => void;
}
declare global { interface Window { timi: DesktopAPI } }
