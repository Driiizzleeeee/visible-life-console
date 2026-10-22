import { DEFAULT_PROJECT_CATEGORIES, type AppData } from './types'

const STORAGE_KEY = 'visible-life-console-v1'
const LEGACY_STORAGE_KEY = 'visible-dashboard-v1'

export const emptyData: AppData = {
  version: 11,
  categories: DEFAULT_PROJECT_CATEGORIES.map((category) => ({ ...category })),
  projects: [],
  activities: [],
  priorities: [],
  manualDone: [],
  calendarEvents: [],
  routineTasks: [],
  routineCompletions: [],
  mottos: [],
  mottoHistory: [],
  mottoCycleRemaining: [],
  mottoDeckSignature: '',
  essentialTasks: [],
  essentialCompletions: [],
  boards: [],
  monthlyLifeItems: [],
  somedayDreams: [],
  lifeMoments: [],
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return emptyData
    return migrateData(JSON.parse(raw))
  } catch {
    return emptyData
  }
}

export function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function downloadJson(data: AppData) {
  download('visible-life-console-backup.json', JSON.stringify(data, null, 2), 'application/json')
}

export function downloadCsv(data: AppData) {
  const header = ['date', 'title', 'category', 'duration_minutes', 'project', 'progress_item', 'evidence', 'notes']
  const rows = data.activities.map((activity) => {
    const project = data.projects.find((item) => item.id === activity.projectId)
    const tracker = project?.trackers.find((item) => item.id === activity.trackerId)
    return [
      activity.date,
      activity.title,
      activity.category,
      activity.durationMinutes,
      project?.title ?? '',
      tracker?.title ?? '',
      activity.isEvidence ? 'yes' : 'no',
      activity.notes ?? '',
    ]
  })
  const csv = '\uFEFF' + [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n')
  download('visible-daily-log.csv', csv, 'text/csv;charset=utf-8')
}

export function parseBackup(text: string): AppData {
  const parsed = JSON.parse(text) as Partial<AppData> & { version?: number }
  if (
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(parsed.version ?? 0) ||
    !Array.isArray(parsed.projects) ||
    !Array.isArray(parsed.activities) ||
    !Array.isArray(parsed.priorities) ||
    !Array.isArray(parsed.manualDone)
  ) {
    throw new Error('This is not a valid Visible Life Console backup.')
  }
  return migrateData(parsed)
}

function migrateData(value: unknown): AppData {
  const parsed = value as Partial<AppData> & { version?: number; projects?: Array<AppData['projects'][number] & { categoryId?: string }> }
  if (
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(parsed.version ?? 0) ||
    !Array.isArray(parsed.projects) ||
    !Array.isArray(parsed.activities) ||
    !Array.isArray(parsed.priorities) ||
    !Array.isArray(parsed.manualDone)
  ) return emptyData

  return {
    ...parsed,
    version: 11,
    categories: Array.isArray(parsed.categories) && parsed.categories.length > 0
      ? parsed.categories
      : DEFAULT_PROJECT_CATEGORIES.map((category) => ({ ...category })),
    projects: parsed.projects.map((project) => ({
      ...project,
      categoryId: project.categoryId || 'study',
      description: typeof project.description === 'string' ? project.description : '',
      supportWork: Array.isArray(project.supportWork) ? project.supportWork.map((item) => ({
        ...item,
        description: typeof item.description === 'string' ? item.description : '',
        estimateMinutes: item.estimateMinutes ? Math.max(1, item.estimateMinutes) : undefined,
        worklogs: Array.isArray(item.worklogs) ? item.worklogs : [],
      })) : [],
      trackers: project.trackers.map((tracker) => ({
        ...tracker,
        tasks: tracker.tasks.map((task) => ({
          ...task,
          description: typeof task.description === 'string' ? task.description : '',
          estimateMinutes: Math.max(1, task.estimateMinutes || 60),
          remainingEstimateMinutes: task.completed ? 0 : Math.max(0, task.remainingEstimateMinutes ?? task.estimateMinutes ?? 60),
          worklogs: Array.isArray(task.worklogs) ? task.worklogs : [],
        })),
      })),
    })),
    activities: parsed.activities,
    priorities: parsed.priorities,
    manualDone: parsed.manualDone,
    calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : [],
    routineTasks: Array.isArray(parsed.routineTasks) ? parsed.routineTasks.map((task) => ({
      ...task,
      ...(task.frequency === 'weekly' ? { weeklyTarget: Math.max(1, task.weeklyTarget || 1) } : {}),
    })) : [],
    routineCompletions: Array.isArray(parsed.routineCompletions)
      ? parsed.routineCompletions.filter((completion) => parsed.routineTasks?.some((task) => task.id === completion.taskId))
      : [],
    mottos: Array.isArray(parsed.mottos) ? parsed.mottos : [],
    mottoHistory: Array.isArray(parsed.mottoHistory) ? parsed.mottoHistory : [],
    mottoCycleRemaining: Array.isArray(parsed.mottoCycleRemaining) ? parsed.mottoCycleRemaining : [],
    mottoDeckSignature: typeof parsed.mottoDeckSignature === 'string' ? parsed.mottoDeckSignature : '',
    essentialTasks: Array.isArray(parsed.essentialTasks) ? parsed.essentialTasks : [],
    essentialCompletions: Array.isArray(parsed.essentialCompletions)
      ? parsed.essentialCompletions.filter((completion) => parsed.essentialTasks?.some((task) => task.id === completion.taskId))
      : [],
    boards: Array.isArray(parsed.boards) ? parsed.boards : [],
    monthlyLifeItems: Array.isArray(parsed.monthlyLifeItems) ? parsed.monthlyLifeItems : [],
    somedayDreams: Array.isArray(parsed.somedayDreams) ? parsed.somedayDreams : [],
    lifeMoments: Array.isArray(parsed.lifeMoments) ? parsed.lifeMoments : [],
  }
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
