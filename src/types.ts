export const CATEGORIES = [
  'Core Work',
  'Support',
  'Admin',
  'Planning',
  'Social',
  'Recovery',
  'Friction',
] as const

export type Category = (typeof CATEGORIES)[number]

export type Difficulty = 'easy' | 'medium' | 'hard'
export type ActualDifficulty = 'easier' | 'as-expected' | 'harder'

export interface TaskWorklog {
  id: string
  date: string
  minutes: number
  note?: string
}

export interface StockTask {
  id: string
  title: string
  description?: string
  completed: boolean
  completedAt?: string
  parentId?: string
  estimateMinutes: number
  remainingEstimateMinutes: number
  worklogs: TaskWorklog[]
  collapsed?: boolean
}

export const SUPPORT_WORK_TYPES = [
  'Learning',
  'Research',
  'Investigation',
  'Troubleshooting',
  'Planning',
  'Communication',
  'Organisation',
  'Unsuccessful exploration',
  'Other',
] as const

export type SupportWorkType = (typeof SUPPORT_WORK_TYPES)[number]

export interface SupportWorkItem {
  id: string
  title: string
  description?: string
  type: SupportWorkType
  completed: boolean
  completedAt?: string
  estimateMinutes?: number
  worklogs: TaskWorklog[]
}

export interface Tracker {
  id: string
  title: string
  current: number
  target: number
  tasks: StockTask[]
  collapsed?: boolean
  progressMode?: 'completion' | 'time'
  nextAction?: string
  nextActionMinutes?: number
  isUncertain?: boolean
}

export interface ProjectCategory {
  id: string
  title: string
  color: string
}

export const DEFAULT_PROJECT_CATEGORIES: ProjectCategory[] = [
  { id: 'study', title: '学习', color: '#e85d3f' },
  { id: 'life', title: '生活', color: '#d39a27' },
  { id: 'games', title: '游戏', color: '#9366a5' },
  { id: 'fitness', title: '健身', color: '#397c68' },
  { id: 'health', title: '身体健康', color: '#287d9b' },
]

export interface Project {
  id: string
  title: string
  description?: string
  color: string
  categoryId: string
  trackers: Tracker[]
  supportWork: SupportWorkItem[]
}

export interface Activity {
  id: string
  title: string
  date: string
  durationMinutes: number
  category: Category
  projectId?: string
  trackerId?: string
  notes?: string
  isEvidence: boolean
  expectedMinutes?: number
  expectedDifficulty?: Difficulty
  actualDifficulty?: ActualDifficulty
}

export interface Priority {
  id: string
  date: string
  title: string
  completed: boolean
  projectId?: string
}

export interface ManualDone {
  id: string
  title: string
  date: string
}

export interface CalendarEvent {
  id: string
  title: string
  date: string
  time?: string
  color?: CalendarEventColor
  lifeItemId?: string
}

export type CalendarEventColor = 'slate' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'pink'

export type RoutineFrequency = 'daily' | 'weekly'

export interface RoutineTask {
  id: string
  title: string
  frequency: RoutineFrequency
  weeklyTarget?: number
}

export interface RoutineCompletion {
  id: string
  taskId: string
  date: string
}

export interface Motto {
  id: string
  text: string
}

export interface MottoHistory {
  date: string
  mottoId: string
}

export interface MonthlyLifeItem {
  id: string
  title: string
  recursMonthly: boolean
  month?: string
}

export interface SomedayDream {
  id: string
  title: string
  createdAt: string
  realisedMomentId?: string
}

export interface LifeMoment {
  id: string
  title: string
  date: string
  place?: string
  reflection?: string
  source?: 'monthly' | 'dream' | 'direct'
  sourceId?: string
}

export interface EssentialTask {
  id: string
  title: string
}

export interface EssentialCompletion {
  id: string
  taskId: string
  date: string
}

export interface BoardColumn {
  id: string
  title: string
}

export interface BoardItem {
  id: string
  title: string
  columnId: string
  completedAt?: string
}

export interface LifeBoard {
  id: string
  title: string
  columns: BoardColumn[]
  items: BoardItem[]
}

export interface ActiveTimer {
  startedAt: string
  title: string
  category: Category
  projectId?: string
  trackerId?: string
  isEvidence: boolean
  expectedMinutes?: number
  expectedDifficulty?: Difficulty
  focusId?: string
  branchId?: string
}

export interface TaskBranch {
  id: string
  title: string
  status: 'parked' | 'active' | 'done'
  createdAt: string
  completedAt?: string
}

export interface FocusPlan {
  id: string
  title: string
  nextAction: string
  estimatedMinutes?: number
  expectedDifficulty?: Difficulty
  projectId?: string
  trackerId?: string
  branches: TaskBranch[]
  activeBranchId?: string
}

export interface AppData {
  version: 11
  categories: ProjectCategory[]
  projects: Project[]
  activities: Activity[]
  priorities: Priority[]
  manualDone: ManualDone[]
  calendarEvents: CalendarEvent[]
  routineTasks: RoutineTask[]
  routineCompletions: RoutineCompletion[]
  mottos: Motto[]
  mottoHistory: MottoHistory[]
  mottoCycleRemaining: string[]
  mottoDeckSignature: string
  essentialTasks: EssentialTask[]
  essentialCompletions: EssentialCompletion[]
  boards: LifeBoard[]
  monthlyLifeItems: MonthlyLifeItem[]
  somedayDreams: SomedayDream[]
  lifeMoments: LifeMoment[]
  activeTimer?: ActiveTimer
  focusPlan?: FocusPlan
}
