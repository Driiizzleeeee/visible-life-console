import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, SUPPORT_WORK_TYPES, type Activity, type ActualDifficulty, type AppData, type BoardItem, type CalendarEvent, type CalendarEventColor, type Category, type Difficulty, type LifeBoard, type LifeMoment, type Motto, type MonthlyLifeItem, type Project, type ProjectCategory, type RoutineTask, type SomedayDream, type StockTask, type SupportWorkItem, type SupportWorkType, type TaskWorklog } from './types'
import { downloadCsv, downloadJson, loadData, parseBackup, saveData } from './storage'

const COLORS = ['#e85d3f', '#397c68', '#5573c7', '#d39a27', '#9366a5', '#287d9b']
const ROUTINE_RANGE_KEY = 'visible-routine-activity-range'
const CALENDAR_EVENT_COLORS: Array<{ id: CalendarEventColor; label: string; accent: string; soft: string; text: string }> = [
  { id: 'slate', label: 'Grey', accent: '#68736f', soft: '#edf0ee', text: '#46504c' },
  { id: 'blue', label: 'Blue', accent: '#527aa3', soft: '#e8f0f7', text: '#365b7f' },
  { id: 'green', label: 'Green', accent: '#4f7968', soft: '#e6efeb', text: '#31493f' },
  { id: 'yellow', label: 'Yellow', accent: '#a77922', soft: '#f7efd9', text: '#765719' },
  { id: 'orange', label: 'Orange', accent: '#b5673e', soft: '#f6e9df', text: '#7e472c' },
  { id: 'red', label: 'Red', accent: '#a85656', soft: '#f5e5e5', text: '#783d3d' },
  { id: 'purple', label: 'Purple', accent: '#7b659b', soft: '#eee9f5', text: '#594574' },
  { id: 'pink', label: 'Pink', accent: '#a85f7d', soft: '#f5e7ed', text: '#774158' },
]

function calendarEventPalette(color?: CalendarEventColor) {
  return CALENDAR_EVENT_COLORS.find((option) => option.id === color) ?? CALENDAR_EVENT_COLORS[2]
}

function id() {
  return crypto.randomUUID()
}

function localDate(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 10)
}

function localMonth(date = new Date()) {
  return localDate(date).slice(0, 7)
}

function startOfWeek(offset = 0) {
  const date = new Date()
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day + 1 + offset * 7)
  return date
}

function dateInWeek(value: string | undefined, weekStart: Date) {
  if (!value) return false
  const date = new Date(`${value}T00:00:00`)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return date >= weekStart && date < weekEnd
}

function formatMinutes(minutes: number) {
  if (!minutes) return '0m'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours ? `${hours}h` : '', rest ? `${rest}m` : ''].filter(Boolean).join(' ')
}

function renderMottoText(text: string) {
  return text.split(/(\*\*[\s\S]+?\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>,
  )
}

function mottoLengthClass(text: string) {
  const visibleLength = text.replace(/\*\*/g, '').length
  const lineCount = text.split(/\r?\n/).length
  if (visibleLength > 150 || lineCount > 5) return 'motto-text-long'
  if (visibleLength > 75 || lineCount > 3) return 'motto-text-medium'
  return 'motto-text-short'
}

function taskChildren(tasks: StockTask[], parentId?: string) {
  return tasks.filter((task) => task.parentId === parentId)
}

function descendantIds(tasks: StockTask[], taskId: string): Set<string> {
  const result = new Set<string>([taskId])
  const visit = (parentId: string) => taskChildren(tasks, parentId).forEach((child) => {
    if (result.has(child.id)) return
    result.add(child.id)
    visit(child.id)
  })
  visit(taskId)
  return result
}

function loggedMinutes(task: StockTask) {
  return task.worklogs.reduce((sum, log) => sum + log.minutes, 0)
}

function calculatedRemaining(task: StockTask) {
  return task.completed ? 0 : Math.max(0, Math.max(1, task.estimateMinutes || 60) - loggedMinutes(task))
}

function taskMetrics(tasks: StockTask[], rootId?: string) {
  const scope = rootId ? descendantIds(tasks, rootId) : new Set(tasks.map((task) => task.id))
  const scopedTasks = tasks.filter((task) => scope.has(task.id))
  const leaves = scopedTasks.filter((task) => !tasks.some((child) => child.parentId === task.id))
  const estimated = leaves.reduce((sum, task) => sum + Math.max(1, task.estimateMinutes || 60), 0)
  const spent = scopedTasks.reduce((sum, task) => sum + task.worklogs.reduce((total, log) => total + log.minutes, 0), 0)
  const remaining = leaves.reduce((sum, task) => sum + calculatedRemaining(task), 0)
  const completedWeight = leaves.reduce((sum, task) => sum + (task.completed ? Math.max(1, task.estimateMinutes || 60) : 0), 0)
  return { estimated, spent, remaining, completedWeight, percent: estimated ? Math.round(completedWeight / estimated * 100) : 0, leafCount: leaves.length }
}

function syncParentTasks(tasks: StockTask[]) {
  const next = tasks.map((task) => ({ ...task }))
  const byId = new Map(next.map((task) => [task.id, task]))
  const resolving = new Set<string>()
  function resolve(task: StockTask): boolean {
    const children = taskChildren(next, task.id)
    if (children.length === 0) return task.completed
    if (resolving.has(task.id)) return false
    resolving.add(task.id)
    const completed = children.every(resolve)
    resolving.delete(task.id)
    const current = byId.get(task.id)!
    current.completed = completed
    current.completedAt = completed ? current.completedAt ?? localDate() : undefined
    current.remainingEstimateMinutes = completed ? 0 : current.remainingEstimateMinutes || current.estimateMinutes
    return completed
  }
  next.forEach(resolve)
  return next
}

function trackerPercent(project: Project, trackerId: string) {
  const tracker = project.trackers.find((item) => item.id === trackerId)
  if (!tracker) return 0
  if (tracker.tasks.length > 0) return taskMetrics(tracker.tasks).percent
  return tracker.target ? Math.round(Math.min(100, Math.max(0, tracker.current / tracker.target * 100))) : 0
}

function weekLabel(offset: number, start: Date) {
  if (offset === 0) return 'This week'
  if (offset === -1) return 'Last week'
  return `Week of ${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
}

function projectPercent(project: Project) {
  return projectMetrics(project).percent
}

function projectMetrics(project: Project) {
  const direct = project.trackers.reduce((result, tracker) => {
    const metrics = taskMetrics(tracker.tasks)
    return {
      estimated: result.estimated + metrics.estimated,
      spent: result.spent + metrics.spent,
      remaining: result.remaining + metrics.remaining,
      completedWeight: result.completedWeight + metrics.completedWeight,
      leafCount: result.leafCount + metrics.leafCount,
    }
  }, { estimated: 0, spent: 0, remaining: 0, completedWeight: 0, leafCount: 0 })
  const supportSpent = project.supportWork.reduce((sum, item) => sum + item.worklogs.reduce((itemTotal, log) => itemTotal + log.minutes, 0), 0)
  return {
    ...direct,
    supportSpent,
    totalSpent: direct.spent + supportSpent,
    percent: direct.estimated ? Math.round(direct.completedWeight / direct.estimated * 100) : 0,
  }
}

export default function App() {
  const [data, setData] = useState<AppData>(loadData)
  const [page, setPage] = useState<'dashboard' | 'focus' | 'manage' | 'routines' | 'boards' | 'mottos' | 'life'>('dashboard')
  const [weekOffset, setWeekOffset] = useState(0)
  const [logOpen, setLogOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [reflectionActivityId, setReflectionActivityId] = useState<string>()

  useEffect(() => saveData(data), [data])
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('dashboard')}>
          <span className="brand-mark">V</span>
          <span><strong>Visible</strong><small>External working memory</small></span>
        </button>
        <nav>
          <button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>Dashboard</button>
          <button className={page === 'focus' ? 'active' : ''} onClick={() => setPage('focus')}>Focus</button>
          <button className={page === 'manage' ? 'active' : ''} onClick={() => setPage('manage')}>Manage</button>
          <button className={page === 'routines' ? 'active' : ''} onClick={() => setPage('routines')}>Routines</button>
          <button className={page === 'boards' ? 'active' : ''} onClick={() => setPage('boards')}>Boards</button>
          <button className={page === 'mottos' ? 'active' : ''} onClick={() => setPage('mottos')}>Mottos</button>
          <button className={page === 'life' ? 'active' : ''} onClick={() => setPage('life')}>Life</button>
        </nav>
        <button className="primary compact" onClick={() => setLogOpen(true)}>＋ Log activity</button>
      </header>

      {data.activeTimer && <TimerBar data={data} setData={setData} setNotice={setNotice} onStopped={setReflectionActivityId} />}

      <main>
        {page === 'dashboard' ? (
          <Dashboard
            data={data}
            setData={setData}
            weekOffset={weekOffset}
            setWeekOffset={setWeekOffset}
            openLog={() => setLogOpen(true)}
            openManage={() => setPage('manage')}
            openRoutines={() => setPage('routines')}
            openMottos={() => setPage('mottos')}
            openBoards={() => setPage('boards')}
            openLife={() => setPage('life')}
            setNotice={setNotice}
          />
        ) : page === 'focus' ? (
          <FocusPage data={data} setData={setData} setNotice={setNotice} />
        ) : page === 'manage' ? (
          <Manage data={data} setData={setData} setNotice={setNotice} />
        ) : page === 'routines' ? (
          <RoutineManager data={data} setData={setData} />
        ) : page === 'boards' ? (
          <BoardsPage data={data} setData={setData} />
        ) : page === 'mottos' ? (
          <MottoManager data={data} setData={setData} />
        ) : (
          <LifePage data={data} setData={setData} setNotice={setNotice} />
        )}
      </main>

      {logOpen && <LogDialog data={data} setData={setData} close={() => setLogOpen(false)} />}
      {reflectionActivityId && <ReflectionDialog activityId={reflectionActivityId} setData={setData} close={() => setReflectionActivityId(undefined)} />}
      {notice && <div className="toast">{notice}</div>}
    </div>
  )
}

function Dashboard({
  data,
  setData,
  weekOffset,
  setWeekOffset,
  openLog,
  openManage,
  openRoutines,
  openMottos,
  openBoards,
  openLife,
  setNotice,
}: {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  weekOffset: number
  setWeekOffset: React.Dispatch<React.SetStateAction<number>>
  openLog: () => void
  openManage: () => void
  openRoutines: () => void
  openMottos: () => void
  openBoards: () => void
  openLife: () => void
  setNotice: (value: string) => void
}) {
  const weekStart = startOfWeek(weekOffset)
  const selectedActivities = data.activities.filter((item) => dateInWeek(item.date, weekStart))
  const today = localDate()
  const priority = data.priorities.find((item) => item.date === today)
  const [priorityTitle, setPriorityTitle] = useState(priority?.title ?? '')
  const [essentialsExpanded, setEssentialsExpanded] = useState(false)

  useEffect(() => setPriorityTitle(priority?.title ?? ''), [priority?.title])
  useEffect(() => {
    setData((current) => {
      const ids = current.mottos.map((motto) => motto.id)
      if (ids.length === 0) return current
      const signature = [...ids].sort().join('|')
      const validIds = new Set(ids)
      const existing = current.mottoHistory.find((item) => item.date === today && validIds.has(item.mottoId))
      if (existing) return current
      let remaining = current.mottoDeckSignature === signature
        ? current.mottoCycleRemaining.filter((mottoId) => validIds.has(mottoId))
        : [...ids]
      if (remaining.length === 0) remaining = [...ids]
      const recent = current.mottoHistory
        .filter((item) => item.date < today && validIds.has(item.mottoId))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 4)
        .map((item) => item.mottoId)
      const preferred = remaining.filter((mottoId) => !recent.includes(mottoId))
      const pool = preferred.length > 0 ? preferred : remaining
      const selected = pool[Math.floor(Math.random() * pool.length)]
      return {
        ...current,
        mottoHistory: [...current.mottoHistory.filter((item) => item.date !== today), { date: today, mottoId: selected }],
        mottoCycleRemaining: remaining.filter((mottoId) => mottoId !== selected),
        mottoDeckSignature: signature,
      }
    })
  }, [data.mottos, setData, today])

  const evidence = useMemo(() => {
    const result: { id: string; title: string; date: string; source: string }[] = []
    data.manualDone.forEach((item) => {
      if (dateInWeek(item.date, weekStart)) result.push({ ...item, source: 'Manual' })
    })
    selectedActivities.forEach((item) => {
      if (item.isEvidence) result.push({ id: item.id, title: item.title, date: item.date, source: item.category })
    })
    data.projects.forEach((project) => project.trackers.forEach((tracker) => tracker.tasks.forEach((task) => {
      const isLeaf = !tracker.tasks.some((child) => child.parentId === task.id)
      if (isLeaf && task.completed && dateInWeek(task.completedAt, weekStart)) {
        result.push({ id: task.id, title: task.title, date: task.completedAt!, source: project.title })
      }
    })))
    return result.sort((a, b) => b.date.localeCompare(a.date))
  }, [data, selectedActivities, weekStart.getTime()])

  const totals = CATEGORIES.map((category) => ({
    category,
    minutes: selectedActivities.filter((item) => item.category === category).reduce((sum, item) => sum + item.durationMinutes, 0),
  }))
  const maxMinutes = Math.max(...totals.map((item) => item.minutes), 1)
  const projectTotals = data.projects.map((project) => ({
    ...project,
    minutes: selectedActivities.filter((item) => item.projectId === project.id).reduce((sum, item) => sum + item.durationMinutes, 0),
  })).filter((item) => item.minutes > 0)
  const projectMinutes = projectTotals.reduce((sum, item) => sum + item.minutes, 0)
  const priorities = data.priorities.filter((item) => dateInWeek(item.date, weekStart))
  const priorityRate = priorities.length ? Math.round(priorities.filter((item) => item.completed).length / priorities.length * 100) : 0
  const reflections = selectedActivities.filter((item) => item.actualDifficulty)

  function savePriority(event: FormEvent) {
    event.preventDefault()
    const title = priorityTitle.trim()
    if (!title) return
    setData((current) => ({
      ...current,
      priorities: priority
        ? current.priorities.map((item) => item.id === priority.id ? { ...item, title } : item)
        : [...current.priorities, { id: id(), date: today, title, completed: false }],
    }))
  }

  const todayMottoId = data.mottoHistory.find((item) => item.date === today)?.mottoId
  const todayMotto = data.mottos.find((item) => item.id === todayMottoId)
  const essentialDoneIds = new Set(data.essentialCompletions.filter((item) => item.date === today).map((item) => item.taskId))
  const essentialsComplete = data.essentialTasks.length > 0 && data.essentialTasks.every((task) => essentialDoneIds.has(task.id))
  const openBoardItems = data.boards.reduce((sum, board) => sum + board.items.filter((item) => !item.completedAt).length, 0)

  function toggleEssential(taskId: string) {
    setData((current) => {
      const completed = current.essentialCompletions.some((item) => item.taskId === taskId && item.date === today)
      return { ...current, essentialCompletions: completed
        ? current.essentialCompletions.filter((item) => !(item.taskId === taskId && item.date === today))
        : [...current.essentialCompletions, { id: id(), taskId, date: today }] }
    })
  }

  const priorityCard = <article className="card priority-card hero-priority-card">
    <div className="card-heading"><div><span className="number">01</span><h2>Today’s #1</h2></div><span className="status-dot">One thing only</span></div>
    {priority ? <div className="priority-content">
      <button className={`big-check ${priority.completed ? 'checked' : ''}`} aria-label="Toggle priority" onClick={() => setData((current) => ({ ...current, priorities: current.priorities.map((item) => item.id === priority.id ? { ...item, completed: !item.completed } : item) }))}>{priority.completed ? '✓' : ''}</button>
      <div><p>{priority.title}</p><small>{priority.completed ? 'Completed today' : 'Protect time for this today'}</small></div>
      <button className="text-button" onClick={() => setData((current) => ({ ...current, priorities: current.priorities.filter((item) => item.id !== priority.id) }))}>Change</button>
    </div> : <form className="inline-form" onSubmit={savePriority}><input value={priorityTitle} onChange={(event) => setPriorityTitle(event.target.value)} placeholder="What matters most today?" /><button className="primary">Set priority</button></form>}
  </article>

  return <div className="dashboard-with-sidebar">
    <div className="dashboard-sidebar-stack">
      <aside className="motto-card">
        <div className="motto-card-heading"><p className="eyebrow">Words for today</p><button onClick={openMottos}>Manage</button></div>
        {todayMotto ? <blockquote className={mottoLengthClass(todayMotto.text)}><span className="motto-text-content">“{renderMottoText(todayMotto.text)}”</span></blockquote> : <div className="motto-empty"><strong>Your wall, without the wall.</strong><span>Add a motto and one will appear here each day.</span></div>}
      </aside>
      <RoutineSidebar data={data} setData={setData} openManager={openRoutines} />
      <aside className={`essential-card ${essentialsComplete ? 'complete' : ''}`}>
        <div className="sidebar-card-heading"><div><p className="eyebrow">Daily essentials</p><h2>{essentialDoneIds.size}/{data.essentialTasks.length}</h2></div><div className="sidebar-heading-actions"><button onClick={openRoutines}>Manage</button><button className="collapse-toggle" aria-expanded={essentialsExpanded} onClick={() => setEssentialsExpanded((value) => !value)}>{essentialsExpanded ? '−' : '+'}</button></div></div>
        {essentialsExpanded && (data.essentialTasks.length === 0 ? <p className="sidebar-card-empty">Add the few things that make today feel complete.</p> : <div className="essential-checklist">{data.essentialTasks.map((task) => <label className={essentialDoneIds.has(task.id) ? 'complete' : ''} key={task.id}><input type="checkbox" checked={essentialDoneIds.has(task.id)} onChange={() => toggleEssential(task.id)} /><span>{task.title}</span></label>)}</div>)}
      </aside>
    </div>
    <div className="dashboard-main">
    {essentialsComplete && <div className="enough-banner"><span>✓</span><div><strong>Today’s essentials are complete.</strong><p>The rest can follow its real urgency — or you can allow yourself to enjoy the day.</p></div></div>}
    <section className="hero-row dashboard-hero">
      <div>
        <p className="eyebrow">{new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>Your progress at a glance.</h1>
        <p className="muted">Long-term progress stays visible even when a new week begins.</p>
      </div>
      {priorityCard}
    </section>

    <section className="dashboard-grid">
      <div className="dashboard-top-row">
        <article className="card boards-reminder-card dashboard-board-card">
          <div className="sidebar-card-heading"><div><p className="eyebrow">Flexible boards</p><h2>Things for later</h2></div><button onClick={openBoards}>Open</button></div>
          <p>When you have time, energy, or simply do not know what to do next.</p>
          <div><span><strong>{data.boards.length}</strong> boards</span><span><strong>{openBoardItems}</strong> open items</span></div>
        </article>

        <RoutineHeatmap data={data} />
      </div>

      <article className="card stock-card overview-stock">
        <div className="card-heading"><div><span className="number">03</span><h2>All project progress</h2></div><button className="text-button" onClick={openManage}>Manage projects</button></div>
        {data.projects.length === 0 ? <EmptyState title="No progress stock yet" detail="Add a course or project, then track objective units." action="Add a project" onAction={openManage} /> :
          <div className="category-overview">{data.categories.map((category) => {
            const projects = data.projects.filter((project) => project.categoryId === category.id)
            return <section className="category-group" key={category.id}>
              <div className="category-title"><i style={{ background: category.color }} /><h3>{category.title}</h3><span>{projects.length} projects</span></div>
              {projects.length === 0 ? <p className="category-empty">No projects in this category yet.</p> : <div className="category-projects">{projects.map((project) => {
                const percent = projectPercent(project)
                return <div className="project-progress" key={project.id}>
                  <div className="project-progress-line"><span>{project.title}</span><strong>{percent}%</strong></div>
                  <div className="progress" role="progressbar" aria-label={`${project.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%`, background: project.color }} /></div>
                  <small>{projectMetrics(project).leafCount} deliverable tasks · {formatMinutes(projectMetrics(project).totalSpent)} invested</small>
                </div>
              })}</div>}
            </section>
          })}</div>}
      </article>

      <MonthCalendar data={data} setData={setData} openLife={openLife} setNotice={setNotice} />

      <div className="week-navigation-row">
        <div><p className="eyebrow">Weekly review</p><span>Change the week shown in the two cards below.</span></div>
        <div className="week-switcher">
          <button aria-label="Previous week" onClick={() => setWeekOffset((value) => value - 1)}>←</button>
          <span><strong>{weekLabel(weekOffset, weekStart)}</strong><small>{localDate(weekStart)} — {localDate(new Date(weekStart.getTime() + 6 * 86_400_000))}</small></span>
          <button aria-label="Next week" disabled={weekOffset >= 0} onClick={() => setWeekOffset((value) => value + 1)}>→</button>
        </div>
      </div>

      <article className="card done-card">
        <div className="card-heading"><div><span className="number">05</span><h2>Done {weekOffset === 0 ? 'this week' : ''}</h2></div><span className="count-pill">{evidence.length} outputs</span></div>
        {evidence.length === 0 ? <EmptyState title="No visible evidence yet" detail="Completed tasks and marked activities will collect here." action="Log something done" onAction={openLog} /> :
          <div className="evidence-list">{evidence.map((item) => <div className="evidence" key={`${item.source}-${item.id}`}><span>✓</span><div><strong>{item.title}</strong><small>{item.source} · {new Date(`${item.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short' })}</small></div></div>)}</div>}
      </article>

      <article className="card stats-card">
        <div className="card-heading"><div><span className="number">06</span><h2>Week so far</h2></div><span className="count-pill">#1 hit {priorityRate}%</span></div>
        <div className="category-stats">{totals.map((item) => <div className="category-row" key={item.category}>
          <span>{item.category}</span><div className="mini-bar"><i style={{ width: `${item.minutes / maxMinutes * 100}%` }} /></div><strong>{formatMinutes(item.minutes)}</strong>
        </div>)}</div>
        {projectTotals.length > 0 && <div className="project-split"><p className="eyebrow">Project share</p>{projectTotals.map((project) => <div key={project.id}><span><i style={{ background: project.color }} />{project.title}</span><strong>{Math.round(project.minutes / projectMinutes * 100)}%</strong></div>)}</div>}
        {reflections.length > 0 && <div className="calibration-summary"><p className="eyebrow">Expectation check</p><div><span><strong>{reflections.filter((item) => item.actualDifficulty === 'easier').length}</strong>Easier</span><span><strong>{reflections.filter((item) => item.actualDifficulty === 'as-expected').length}</strong>About right</span><span><strong>{reflections.filter((item) => item.actualDifficulty === 'harder').length}</strong>Harder</span></div><small>Observed sessions only — never a productivity score.</small></div>}
      </article>
    </section>
    </div>
  </div>
}

function RoutineSidebar({ data, setData, openManager }: {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  openManager: () => void
}) {
  const today = localDate()
  const weekStart = startOfWeek()
  const [expanded, setExpanded] = useState(false)

  function periodCount(task: RoutineTask) {
    return data.routineCompletions.filter((completion) => completion.taskId === task.id && (
      task.frequency === 'daily' ? completion.date === today : dateInWeek(completion.date, weekStart)
    )).length
  }

  function toggleDaily(task: RoutineTask) {
    const completed = periodCount(task) > 0
    setData((current) => ({
      ...current,
      routineCompletions: completed
        ? current.routineCompletions.filter((completion) => !(completion.taskId === task.id && completion.date === today))
        : [...current.routineCompletions, { id: id(), taskId: task.id, date: today }],
    }))
  }

  function addWeekly(task: RoutineTask) {
    setData((current) => {
      const count = current.routineCompletions.filter((item) => item.taskId === task.id && dateInWeek(item.date, weekStart)).length
      if (count >= (task.weeklyTarget ?? 1)) return current
      return { ...current, routineCompletions: [...current.routineCompletions, { id: id(), taskId: task.id, date: today }] }
    })
  }

  function undoWeekly(task: RoutineTask) {
    setData((current) => {
      const matches = current.routineCompletions.filter((item) => item.taskId === task.id && dateInWeek(item.date, weekStart))
      const todayMatch = [...matches].reverse().find((item) => item.date === today)
      const latest = todayMatch ?? [...matches].sort((a, b) => b.date.localeCompare(a.date))[0]
      return latest ? { ...current, routineCompletions: current.routineCompletions.filter((item) => item.id !== latest.id) } : current
    })
  }

  const daily = data.routineTasks.filter((task) => task.frequency === 'daily')
  const weekly = data.routineTasks.filter((task) => task.frequency === 'weekly')
  const dailyDone = daily.filter((task) => periodCount(task) > 0).length
  const weeklyDone = weekly.reduce((sum, task) => sum + Math.min(periodCount(task), task.weeklyTarget ?? 1), 0)
  const weeklyTargetTotal = weekly.reduce((sum, task) => sum + (task.weeklyTarget ?? 1), 0)

  function dailyGroup() {
    return <section className="routine-group">
      <div className="routine-group-title"><div><h3>Daily</h3><small>Resets each day</small></div><strong>{dailyDone}/{daily.length}</strong></div>
      {daily.length === 0 ? <p>No tasks yet</p> : <div className="routine-checklist">{daily.map((task) => <label className={periodCount(task) > 0 ? 'complete' : ''} key={task.id}>
        <input type="checkbox" checked={periodCount(task) > 0} onChange={() => toggleDaily(task)} />
        <span>{task.title}</span>
      </label>)}</div>}
    </section>
  }

  function weeklyGroup() {
    return <section className="routine-group">
      <div className="routine-group-title"><div><h3>Weekly</h3><small>Any day, target resets Monday</small></div><strong>{weeklyDone}/{weeklyTargetTotal}</strong></div>
      {weekly.length === 0 ? <p>No tasks yet</p> : <div className="weekly-routine-list">{weekly.map((task) => {
        const count = periodCount(task)
        const target = task.weeklyTarget ?? 1
        return <div className={count >= target ? 'complete' : ''} key={task.id}>
          <span>{task.title}<small>{count}/{target} this week</small></span>
          <div><button aria-label={`Undo one ${task.title} completion`} disabled={count === 0} onClick={() => undoWeekly(task)}>−</button><button aria-label={`Add one ${task.title} completion`} disabled={count >= target} onClick={() => addWeekly(task)}>✓</button></div>
        </div>
      })}</div>}
    </section>
  }

  return <aside className="routine-sidebar">
    <div className="routine-sidebar-heading"><div><p className="eyebrow">Repeating tasks</p><h2>Today</h2></div><div className="sidebar-heading-actions"><button onClick={openManager}>Manage</button><button className="collapse-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '−' : '+'}</button></div></div>
    {expanded && <><div className="routine-score"><span><strong>{dailyDone}</strong> daily</span><i /><span><strong>{weeklyDone}</strong> weekly</span></div>{dailyGroup()}{weeklyGroup()}</>}
  </aside>
}

function RoutineHeatmap({ data }: { data: AppData }) {
  type RoutineRange = 'month' | 'quarter' | 'half' | 'year'
  const [mode, setMode] = useState<RoutineRange>(() => {
    const saved = localStorage.getItem(ROUTINE_RANGE_KEY)
    return saved === 'month' || saved === 'quarter' || saved === 'half' || saved === 'year' ? saved : 'half'
  })
  useEffect(() => localStorage.setItem(ROUTINE_RANGE_KEY, mode), [mode])
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    const activeTaskIds = new Set(data.routineTasks.map((task) => task.id))
    data.routineCompletions.forEach((item) => {
      if (activeTaskIds.has(item.taskId)) result.set(item.date, (result.get(item.date) ?? 0) + 1)
    })
    return result
  }, [data.routineCompletions, data.routineTasks])
  const weekCount = mode === 'year' ? 53 : mode === 'half' ? 27 : mode === 'quarter' ? 14 : 5
  const displayWeeks = useMemo(() => {
    const currentWeek = startOfWeek()
    const gridStart = new Date(currentWeek)
    gridStart.setDate(gridStart.getDate() - (weekCount - 1) * 7)
    return Array.from({ length: weekCount }, (_, weekIndex) => Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + weekIndex * 7 + dayIndex)
      const key = localDate(date)
      return { date, key, count: counts.get(key) ?? 0, future: date > new Date() }
    }))
  }, [counts, weekCount])
  const visibleDays = displayWeeks.flat()
  const total = visibleDays.filter((day) => !day.future).reduce((sum, day) => sum + day.count, 0)
  const months = displayWeeks.map((week, index) => ({ index, label: week[0].date.toLocaleDateString('en-AU', { month: 'short' }) }))
    .filter((item, index, list) => index === 0 || item.label !== list[index - 1].label)
  const level = (count: number) => count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4
  const title = (day: { date: Date; count: number }) => `${day.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}: ${day.count} completion${day.count === 1 ? '' : 's'}`
  const modes = [
    { value: 'month' as const, label: 'Month' },
    { value: 'quarter' as const, label: '3 months' },
    { value: 'half' as const, label: '6 months' },
    { value: 'year' as const, label: 'Year' },
  ]
  const periodText = mode === 'year' ? 'the last 12 months' : mode === 'half' ? 'the last 6 months' : mode === 'quarter' ? 'the last 3 months' : 'the last month'
  const gridColumns = mode === 'year' ? `repeat(${weekCount}, 11px)` : `repeat(${weekCount}, minmax(11px, 1fr))`

  return <article className="card routine-heatmap-card">
    <div className="card-heading heatmap-heading"><div><span className="number">02</span><h2>Routine activity</h2></div><div className="heatmap-tabs">{modes.map((item) => <button className={mode === item.value ? 'active' : ''} key={item.value} onClick={() => setMode(item.value)}>{item.label}</button>)}</div></div>
    <div className="heatmap-summary"><strong>{total}</strong><span>completions in {periodText}</span></div>
    <div className="heatmap-scroll" role="img" aria-label={`${total} routine completions in the ${mode} view`}>
      <div className={`heatmap-canvas ${mode}-view`}>
        <div className="heatmap-months" style={{ gridTemplateColumns: gridColumns }}>{months.map((label) => <span key={`${label.index}-${label.label}`} style={{ gridColumn: label.index + 1 }}>{label.label}</span>)}</div>
        <div className="heatmap-body">
          <div className="heatmap-weekdays"><span>Mon</span><span>Wed</span><span>Fri</span></div>
          <div className="heatmap-grid" style={{ gridTemplateColumns: gridColumns }}>{displayWeeks.flatMap((week, weekIndex) => week.map((day, dayIndex) => {
            return <span className={`heatmap-cell level-${level(day.count)} ${day.future ? 'future' : ''}`} style={{ gridColumn: weekIndex + 1, gridRow: dayIndex + 1 }} key={day.key} title={title(day)} />
          }))}</div>
        </div>
      </div>
      <div className="heatmap-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((item) => <i className={`heatmap-cell level-${item}`} key={item} />)}<span>More</span></div>
    </div>
  </article>
}

function MonthCalendar({ data, setData, openLife, setNotice }: {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  openLife: () => void
  setNotice: (value: string) => void
}) {
  const today = localDate()
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState(today)
  const [eventTitle, setEventTitle] = useState('')
  const [eventTime, setEventTime] = useState('')
  const [eventColor, setEventColor] = useState<CalendarEventColor>('blue')
  const [eventType, setEventType] = useState<'regular' | 'life'>('regular')
  const [eventLifeItemId, setEventLifeItemId] = useState('')
  const [editingEventId, setEditingEventId] = useState<string>()

  const days = useMemo(() => {
    const year = visibleMonth.getFullYear()
    const month = visibleMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const mondayOffset = (firstDay.getDay() + 6) % 7
    const gridStart = new Date(year, month, 1 - mondayOffset)
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      return { date, key: localDate(date), inMonth: date.getMonth() === month }
    })
  }, [visibleMonth])

  const selectedEvents = data.calendarEvents
    .filter((item) => item.date === selectedDate)
    .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
  const selectedMonthLifeItems = data.monthlyLifeItems.filter((item) => item.recursMonthly || item.month === selectedDate.slice(0, 7))
  const routineCountsByDate = useMemo(() => {
    const frequencies = new Map(data.routineTasks.map((task) => [task.id, task.frequency]))
    const summaries = new Map<string, { dailyIds: Set<string>; weekly: number }>()
    data.routineCompletions.forEach((completion) => {
      const frequency = frequencies.get(completion.taskId)
      if (!frequency) return
      const summary = summaries.get(completion.date) ?? { dailyIds: new Set<string>(), weekly: 0 }
      if (frequency === 'daily') summary.dailyIds.add(completion.taskId)
      else summary.weekly += 1
      summaries.set(completion.date, summary)
    })
    return summaries
  }, [data.routineCompletions, data.routineTasks])
  const todayRoutineCounts = routineCountsByDate.get(today)
  const todayDailyCount = todayRoutineCounts?.dailyIds.size ?? 0
  const todayWeeklyCount = todayRoutineCounts?.weekly ?? 0
  const boardCountsByDate = useMemo(() => {
    const result = new Map<string, number>()
    data.boards.forEach((board) => board.items.forEach((item) => {
      if (item.completedAt) result.set(item.completedAt, (result.get(item.completedAt) ?? 0) + 1)
    }))
    return result
  }, [data.boards])
  const todayBoardCount = boardCountsByDate.get(today) ?? 0

  function moveMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  function returnToToday() {
    const now = new Date()
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDate(today)
  }

  function selectDay(date: string) {
    setSelectedDate(date)
    setEditingEventId(undefined)
    setEventTitle('')
    setEventTime('')
    setEventColor('blue')
    setEventType('regular')
    setEventLifeItemId('')
  }

  function editEvent(item: CalendarEvent) {
    setEditingEventId(item.id)
    setEventTitle(item.title)
    setEventTime(item.time ?? '')
    setEventColor(item.color ?? 'green')
    setEventType(item.lifeItemId ? 'life' : 'regular')
    setEventLifeItemId(item.lifeItemId ?? '')
  }

  function cancelEventEdit() {
    setEditingEventId(undefined)
    setEventTitle('')
    setEventTime('')
    setEventColor('blue')
    setEventType('regular')
    setEventLifeItemId('')
  }

  function deleteEvent(item: CalendarEvent) {
    setData((current) => ({ ...current, calendarEvents: current.calendarEvents.filter((event) => event.id !== item.id) }))
    if (editingEventId === item.id) cancelEventEdit()
  }

  function addEvent(event: FormEvent) {
    event.preventDefault()
    const title = eventTitle.trim()
    if (!title) return
    const linkedLifeItemId = eventType === 'life' ? eventLifeItemId || id() : undefined
    setData((current) => {
      let monthlyLifeItems = current.monthlyLifeItems
      if (linkedLifeItemId) {
        const exists = monthlyLifeItems.some((item) => item.id === linkedLifeItemId)
        monthlyLifeItems = exists
          ? monthlyLifeItems.map((item) => item.id === linkedLifeItemId ? { ...item, title } : item)
          : [...monthlyLifeItems, { id: linkedLifeItemId, title, recursMonthly: false, month: selectedDate.slice(0, 7) }]
      }
      const eventDetails = { title, date: selectedDate, time: eventTime || undefined, color: eventColor, lifeItemId: linkedLifeItemId }
      const calendarEvents = editingEventId
        ? current.calendarEvents.map((item) => item.id === editingEventId ? { ...item, ...eventDetails } : item)
        : [...current.calendarEvents, { id: id(), ...eventDetails }]
      return { ...current, monthlyLifeItems, calendarEvents }
    })
    setEditingEventId(undefined)
    setEventTitle('')
    setEventTime('')
    setEventColor('blue')
    setEventType('regular')
    setEventLifeItemId('')
  }

  return <article className="card calendar-card">
    <div className="card-heading calendar-heading">
      <div><span className="number">04</span><h2>Monthly calendar</h2></div>
      <div className="calendar-controls">
        <button aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
        <strong>{visibleMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</strong>
        <button aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
        <button className="today-button" onClick={returnToToday}>Today</button>
      </div>
    </div>

    {(todayDailyCount > 0 || todayWeeklyCount > 0 || todayBoardCount > 0) && <div className="calendar-routine-summary">
      <span>✓</span><strong>Today:</strong>
      {todayDailyCount > 0 && <span>{todayDailyCount} daily task{todayDailyCount === 1 ? '' : 's'}</span>}
      {todayDailyCount > 0 && todayWeeklyCount > 0 && <i>·</i>}
      {todayWeeklyCount > 0 && <span>{todayWeeklyCount} weekly completion{todayWeeklyCount === 1 ? '' : 's'}</span>}
      {(todayDailyCount > 0 || todayWeeklyCount > 0) && todayBoardCount > 0 && <i>·</i>}
      {todayBoardCount > 0 && <span>{todayBoardCount} flexible item{todayBoardCount === 1 ? '' : 's'}</span>}
    </div>}

    <div className="calendar-layout">
      <div className="month-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="weekday" key={day}>{day}</div>)}
        {days.map((day) => {
          const dayEvents = data.calendarEvents
            .filter((item) => item.date === day.key)
            .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
          const routineCounts = routineCountsByDate.get(day.key)
          const dailyCount = routineCounts?.dailyIds.size ?? 0
          const weeklyCount = routineCounts?.weekly ?? 0
          const boardCount = boardCountsByDate.get(day.key) ?? 0
          return <button
            className={`calendar-day ${day.inMonth ? '' : 'outside'} ${day.key === today ? 'is-today' : ''} ${day.key === selectedDate ? 'selected' : ''}`}
            key={day.key}
            onClick={() => selectDay(day.key)}
            aria-label={`${day.date.toLocaleDateString('en-AU')} — ${dailyCount} daily tasks, ${weeklyCount} weekly completions, ${boardCount} flexible items, ${dayEvents.length} plans`}
          >
            <span className="day-number">{day.date.getDate()}</span>
            {(dailyCount > 0 || weeklyCount > 0 || boardCount > 0) && <span className="day-routine-counts">
              {dailyCount > 0 && <span className="daily-count" title={`${dailyCount} daily task${dailyCount === 1 ? '' : 's'} completed`}>Daily {dailyCount}</span>}
              {weeklyCount > 0 && <span className="weekly-count" title={`${weeklyCount} weekly completion${weeklyCount === 1 ? '' : 's'}`}>Weekly {weeklyCount}</span>}
              {boardCount > 0 && <span className="board-count" title={`${boardCount} flexible item${boardCount === 1 ? '' : 's'} completed`}>Items {boardCount}</span>}
            </span>}
            <span className="day-events">
              {dayEvents.slice(0, 3).map((item) => {
                const palette = calendarEventPalette(item.color)
                return <span className={`event-chip ${item.lifeItemId ? 'life-event' : ''}`} style={{ borderLeftColor: palette.accent, backgroundColor: palette.soft, color: palette.text }} key={item.id}>{item.lifeItemId && <span className="life-event-heart" aria-label="Life this month">♥</span>}{item.time && <time style={{ color: palette.accent }}>{item.time}</time>}{item.title}</span>
              })}
              {dayEvents.length > 3 && <small>+{dayEvents.length - 3} more</small>}
            </span>
          </button>
        })}
      </div>

      <aside className="day-agenda">
        <div className="agenda-title"><p className="eyebrow">Selected day</p><h3>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</h3></div>
        <div className="agenda-list">
          {selectedEvents.length === 0 ? <p className="agenda-empty">Nothing planned yet.</p> : selectedEvents.map((item) => {
            const palette = calendarEventPalette(item.color)
            return <div className={`agenda-event ${item.lifeItemId ? 'life-event' : ''}`} style={{ borderLeftColor: palette.accent, backgroundColor: palette.soft }} key={item.id}>
            <time style={{ color: palette.accent }}>{item.time || 'Any time'}</time><span style={{ color: palette.text }}>{item.lifeItemId && <span className="life-event-heart" aria-label="Life this month">♥</span>}{item.title}</span>
            <span className="agenda-event-actions"><button aria-label={`Edit ${item.title}`} onClick={() => editEvent(item)}>Edit</button><button aria-label={`Delete ${item.title}`} onClick={() => deleteEvent(item)}>×</button></span>
          </div>})}
        </div>
        <form className={`agenda-form ${editingEventId ? 'editing' : ''}`} onSubmit={addEvent}>
          {editingEventId && <div className="agenda-edit-notice"><span>Editing plan</span><button type="button" onClick={cancelEventEdit}>Cancel</button></div>}
          <fieldset className="calendar-event-type"><legend>Plan type</legend><div>
            <button type="button" className={eventType === 'regular' ? 'selected' : ''} onClick={() => { setEventType('regular'); setEventLifeItemId('') }}>Regular event</button>
            <button type="button" className={eventType === 'life' ? 'selected' : ''} onClick={() => { setEventType('life'); setEventColor('pink') }}>♥ Life invitation</button>
          </div></fieldset>
          <p className="calendar-event-type-help">{eventType === 'life' ? 'Linked to Life this month. Scheduling it does not mark it as lived.' : 'A calendar-only plan with no completion state.'}</p>
          {eventType === 'life' && selectedMonthLifeItems.length > 0 && <select aria-label="Link a Life this month invitation" value={eventLifeItemId} onChange={(event) => {
            const nextId = event.target.value
            setEventLifeItemId(nextId)
            const linkedItem = selectedMonthLifeItems.find((item) => item.id === nextId)
            if (linkedItem) setEventTitle(linkedItem.title)
          }}><option value="">Create a new Life invitation</option>{selectedMonthLifeItems.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>}
          <input aria-label="Plan title" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder={editingEventId ? 'Edit this plan' : 'Add a plan for this day'} />
          <input aria-label="Plan time" type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} />
          <fieldset className="calendar-color-picker"><legend>Colour</legend><div>{CALENDAR_EVENT_COLORS.map((option) => <button
            type="button"
            className={eventColor === option.id ? 'selected' : ''}
            style={{ backgroundColor: option.accent }}
            aria-label={option.label}
            aria-pressed={eventColor === option.id}
            title={option.label}
            key={option.id}
            onClick={() => setEventColor(option.id)}
          >{eventColor === option.id ? '✓' : ''}</button>)}</div></fieldset>
          <button className="primary">{editingEventId ? 'Save changes' : 'Add plan'}</button>
        </form>
        <LifeMonthPanel data={data} setData={setData} month={localDate(visibleMonth).slice(0, 7)} selectedDate={selectedDate} openLife={openLife} setNotice={setNotice} />
      </aside>
    </div>
  </article>
}

function LifeMonthPanel({ data, setData, month, selectedDate, openLife, setNotice }: {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  month: string
  selectedDate: string
  openLife: () => void
  setNotice: (value: string) => void
}) {
  const [dreamTitle, setDreamTitle] = useState('')
  const [momentDraft, setMomentDraft] = useState<{ title: string; date: string; source: LifeMoment['source']; sourceId?: string }>()
  const [momentPlace, setMomentPlace] = useState('')
  const [momentReflection, setMomentReflection] = useState('')
  const items = data.monthlyLifeItems.filter((item) => item.recursMonthly || item.month === month)
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long' })

  function completedMoment(itemId: string) {
    return data.lifeMoments.find((moment) => moment.source === 'monthly' && moment.sourceId === itemId && moment.date.startsWith(month))
  }

  function beginMoment(item?: MonthlyLifeItem) {
    const defaultDate = selectedDate.startsWith(month) ? selectedDate : month === localMonth() ? localDate() : `${month}-01`
    setMomentDraft({ title: item?.title ?? '', date: defaultDate, source: item ? 'monthly' : 'direct', sourceId: item?.id })
    setMomentPlace('')
    setMomentReflection('')
  }

  function toggleItem(item: MonthlyLifeItem) {
    const existing = completedMoment(item.id)
    if (existing) {
      if (!window.confirm('Remove this moment from your Life archive?')) return
      setData((current) => ({ ...current, lifeMoments: current.lifeMoments.filter((moment) => moment.id !== existing.id) }))
      return
    }
    beginMoment(item)
  }

  function saveMoment(event: FormEvent) {
    event.preventDefault()
    if (!momentDraft?.title.trim() || !momentDraft.date) return
    const moment: LifeMoment = {
      id: id(),
      title: momentDraft.title.trim(),
      date: momentDraft.date,
      source: momentDraft.source,
      sourceId: momentDraft.sourceId,
      place: momentPlace.trim() || undefined,
      reflection: momentReflection.trim() || undefined,
    }
    setData((current) => ({ ...current, lifeMoments: [...current.lifeMoments, moment] }))
    setMomentDraft(undefined)
    setMomentPlace('')
    setMomentReflection('')
    setNotice('Saved to Life Moments.')
  }

  function addDream(event: FormEvent) {
    event.preventDefault()
    const title = dreamTitle.trim()
    if (!title) return
    setData((current) => ({ ...current, somedayDreams: [...current.somedayDreams, { id: id(), title, createdAt: localDate() }] }))
    setDreamTitle('')
    setNotice('Saved to Someday Dreams.')
  }

  return <section className="life-month-panel">
    <div className="life-month-heading"><div><p className="eyebrow">Life in {monthLabel}</p></div><button type="button" onClick={openLife}>Open Life →</button></div>
    {items.length === 0 ? <p className="life-month-empty">Nothing is required here. Add something that might bring a little colour to this month.</p> : <div className="life-month-list">{items.map((item) => {
      const completed = completedMoment(item.id)
      return <label className={completed ? 'complete' : ''} key={item.id}><input type="checkbox" checked={Boolean(completed)} onChange={() => toggleItem(item)} /><span>{item.title}{item.recursMonthly && <small>Every month</small>}</span></label>
    })}</div>}
    {momentDraft && <form className="life-moment-quick-form" onSubmit={saveMoment}>
      <div><strong>Record this moment</strong><button type="button" onClick={() => setMomentDraft(undefined)}>Cancel</button></div>
      <input value={momentDraft.title} onChange={(event) => setMomentDraft((current) => current ? { ...current, title: event.target.value } : current)} placeholder="What happened?" />
      <input type="date" value={momentDraft.date} onChange={(event) => setMomentDraft((current) => current ? { ...current, date: event.target.value } : current)} />
      <input value={momentPlace} onChange={(event) => setMomentPlace(event.target.value)} placeholder="Place (optional)" />
      <textarea rows={2} value={momentReflection} onChange={(event) => setMomentReflection(event.target.value)} placeholder="A few words, if you want…" />
      <button className="primary">Save moment</button>
    </form>}
    {!momentDraft && <div className="life-month-actions"><button type="button" onClick={() => beginMoment()}>♡ Record a moment</button></div>}
    <div className="life-dream-capture"><small>Something for someday?</small><form onSubmit={addDream}><input value={dreamTitle} onChange={(event) => setDreamTitle(event.target.value)} placeholder="Save a dream…" /><button aria-label="Save dream">＋</button></form></div>
  </section>
}

function LifePage({ data, setData, setNotice }: {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  setNotice: (value: string) => void
}) {
  const [tab, setTab] = useState<'month' | 'moments' | 'dreams' | 'archive'>('archive')
  const [lifeMonth, setLifeMonth] = useState(localMonth())
  const [momentYear, setMomentYear] = useState(String(new Date().getFullYear()))
  const [newMoment, setNewMoment] = useState({ title: '', date: localDate(), place: '', reflection: '' })
  const [newMonthlyTitle, setNewMonthlyTitle] = useState('')
  const [newMonthlyRepeats, setNewMonthlyRepeats] = useState(true)
  const [newDreamTitle, setNewDreamTitle] = useState('')
  const [sourceDraft, setSourceDraft] = useState<{ kind: 'monthly' | 'dream'; id: string; title: string; date: string; place: string; reflection: string }>()

  const yearOptions = Array.from(new Set([String(new Date().getFullYear()), ...data.lifeMoments.map((moment) => moment.date.slice(0, 4))])).sort((a, b) => b.localeCompare(a))
  const yearMoments = data.lifeMoments.filter((moment) => moment.date.startsWith(momentYear)).sort((a, b) => b.date.localeCompare(a.date))
  const momentMonths = Array.from(new Set(yearMoments.map((moment) => moment.date.slice(0, 7))))
  const monthlyItems = data.monthlyLifeItems.filter((item) => item.recursMonthly || item.month === lifeMonth)
  const activeDreams = data.somedayDreams.filter((dream) => !dream.realisedMomentId)
  const [lifeYearNumber, lifeMonthNumber] = lifeMonth.split('-').map(Number)
  const lifeMonthLastDate = `${lifeMonth}-${String(new Date(lifeYearNumber, lifeMonthNumber, 0).getDate()).padStart(2, '0')}`

  function addMoment(event: FormEvent) {
    event.preventDefault()
    const title = newMoment.title.trim()
    if (!title || !newMoment.date) return
    setData((current) => ({ ...current, lifeMoments: [...current.lifeMoments, {
      id: id(), title, date: newMoment.date, source: 'direct',
      place: newMoment.place.trim() || undefined,
      reflection: newMoment.reflection.trim() || undefined,
    }] }))
    setNewMoment({ title: '', date: localDate(), place: '', reflection: '' })
    setMomentYear(newMoment.date.slice(0, 4))
    setNotice('Saved to Life Moments.')
  }

  function updateMoment(momentId: string, patch: Partial<LifeMoment>) {
    setData((current) => ({ ...current, lifeMoments: current.lifeMoments.map((moment) => moment.id === momentId ? { ...moment, ...patch } : moment) }))
  }

  function removeMoment(moment: LifeMoment) {
    if (!window.confirm(`Delete “${moment.title}” from Life Moments?`)) return
    setData((current) => ({
      ...current,
      lifeMoments: current.lifeMoments.filter((item) => item.id !== moment.id),
      somedayDreams: current.somedayDreams.map((dream) => dream.realisedMomentId === moment.id ? { ...dream, realisedMomentId: undefined } : dream),
    }))
  }

  function addMonthlyItem(event: FormEvent) {
    event.preventDefault()
    const title = newMonthlyTitle.trim()
    if (!title) return
    setData((current) => ({ ...current, monthlyLifeItems: [...current.monthlyLifeItems, {
      id: id(), title, recursMonthly: newMonthlyRepeats, ...(newMonthlyRepeats ? {} : { month: lifeMonth }),
    }] }))
    setNewMonthlyTitle('')
  }

  function updateMonthlyItem(itemId: string, patch: Partial<MonthlyLifeItem>) {
    setData((current) => ({
      ...current,
      monthlyLifeItems: current.monthlyLifeItems.map((item) => item.id === itemId ? { ...item, ...patch } : item),
      calendarEvents: typeof patch.title === 'string'
        ? current.calendarEvents.map((event) => event.lifeItemId === itemId ? { ...event, title: patch.title as string } : event)
        : current.calendarEvents,
    }))
  }

  function scheduleMonthlyItem(item: MonthlyLifeItem, date: string) {
    setData((current) => {
      const existing = current.calendarEvents.find((event) => event.lifeItemId === item.id && event.date.startsWith(lifeMonth))
      if (!date) {
        return { ...current, calendarEvents: current.calendarEvents.filter((event) => event.id !== existing?.id) }
      }
      if (existing) {
        return { ...current, calendarEvents: current.calendarEvents.map((event) => event.id === existing.id ? { ...event, date, title: item.title } : event) }
      }
      return { ...current, calendarEvents: [...current.calendarEvents, { id: id(), title: item.title, date, color: 'pink', lifeItemId: item.id }] }
    })
  }

  function removeMonthlyItem(item: MonthlyLifeItem) {
    if (!window.confirm(`Delete “${item.title}”? Existing Life Moments will remain.`)) return
    setData((current) => ({
      ...current,
      monthlyLifeItems: current.monthlyLifeItems.filter((entry) => entry.id !== item.id),
      calendarEvents: current.calendarEvents.map((event) => event.lifeItemId === item.id ? { ...event, lifeItemId: undefined } : event),
    }))
  }

  function addDream(event: FormEvent) {
    event.preventDefault()
    const title = newDreamTitle.trim()
    if (!title) return
    setData((current) => ({ ...current, somedayDreams: [...current.somedayDreams, { id: id(), title, createdAt: localDate() }] }))
    setNewDreamTitle('')
  }

  function updateDream(dreamId: string, title: string) {
    setData((current) => ({ ...current, somedayDreams: current.somedayDreams.map((dream) => dream.id === dreamId ? { ...dream, title } : dream) }))
  }

  function undoDream(dream: SomedayDream) {
    if (!dream.realisedMomentId) return
    setData((current) => ({
      ...current,
      somedayDreams: current.somedayDreams.map((item) => item.id === dream.id ? { ...item, realisedMomentId: undefined } : item),
      lifeMoments: current.lifeMoments.map((moment) => moment.id === dream.realisedMomentId ? { ...moment, source: 'direct', sourceId: undefined } : moment),
    }))
    setNotice('Dream returned to Someday. The Life Moment was kept.')
  }

  function removeDream(dream: SomedayDream) {
    if (!window.confirm(`Delete “${dream.title}” from Someday Dreams?`)) return
    setData((current) => ({
      ...current,
      somedayDreams: current.somedayDreams.filter((item) => item.id !== dream.id),
      lifeMoments: current.lifeMoments.map((moment) => moment.id === dream.realisedMomentId ? { ...moment, source: 'direct', sourceId: undefined } : moment),
    }))
  }

  function beginSourceMoment(kind: 'monthly' | 'dream', sourceId: string, title: string, date = localDate()) {
    setSourceDraft({ kind, id: sourceId, title, date, place: '', reflection: '' })
  }

  function saveSourceMoment(event: FormEvent) {
    event.preventDefault()
    if (!sourceDraft?.title.trim() || !sourceDraft.date) return
    const momentId = id()
    const moment: LifeMoment = {
      id: momentId,
      title: sourceDraft.title.trim(),
      date: sourceDraft.date,
      place: sourceDraft.place.trim() || undefined,
      reflection: sourceDraft.reflection.trim() || undefined,
      source: sourceDraft.kind,
      sourceId: sourceDraft.id,
    }
    setData((current) => ({
      ...current,
      lifeMoments: [...current.lifeMoments, moment],
      somedayDreams: sourceDraft.kind === 'dream'
        ? current.somedayDreams.map((dream) => dream.id === sourceDraft.id ? { ...dream, realisedMomentId: momentId } : dream)
        : current.somedayDreams,
    }))
    setSourceDraft(undefined)
    setNotice('Saved to Life Moments.')
  }

  const sourceMomentForm = sourceDraft && <form className="life-source-form" onSubmit={saveSourceMoment}>
    <div className="life-source-heading"><div><p className="eyebrow">Record this moment</p><h3>{sourceDraft.title}</h3></div><button type="button" onClick={() => setSourceDraft(undefined)}>Cancel</button></div>
    <input value={sourceDraft.title} onChange={(event) => setSourceDraft((current) => current ? { ...current, title: event.target.value } : current)} placeholder="What happened?" />
    <input type="date" value={sourceDraft.date} onChange={(event) => setSourceDraft((current) => current ? { ...current, date: event.target.value } : current)} />
    <input value={sourceDraft.place} onChange={(event) => setSourceDraft((current) => current ? { ...current, place: event.target.value } : current)} placeholder="Place (optional)" />
    <textarea rows={3} value={sourceDraft.reflection} onChange={(event) => setSourceDraft((current) => current ? { ...current, reflection: event.target.value } : current)} placeholder="A few words, if you want…" />
    <button className="primary">Save moment</button>
  </form>

  return <>
    <section className="hero-row life-hero"><div><p className="eyebrow">Life</p><h1>Keep evidence that you lived.</h1><p className="muted">Invitations, dreams, and moments — never a productivity score.</p></div></section>
    <div className="life-tabs" role="tablist">
      <button className={tab === 'month' ? 'active' : ''} onClick={() => setTab('month')}>This Month</button>
      <button className={tab === 'moments' ? 'active' : ''} onClick={() => setTab('moments')}>Moments</button>
      <button className={tab === 'dreams' ? 'active' : ''} onClick={() => setTab('dreams')}>Someday Dreams</button>
      <button className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}>Life Archive</button>
    </div>

    {tab === 'archive' && <article className="card life-archive-card">
        <div className="card-heading"><div><span className="number">01</span><h2>Life archive</h2></div><select aria-label="Archive year" value={momentYear} onChange={(event) => setMomentYear(event.target.value)}>{yearOptions.map((year) => <option key={year}>{year}</option>)}</select></div>
        <p className="life-year-summary">{yearMoments.length === 0 ? 'Nothing was recorded here. The year still belonged to you.' : `${yearMoments.length} moment${yearMoments.length === 1 ? '' : 's'} recorded in ${momentYear}.`}</p>
        <div className="life-archive">{momentMonths.map((month) => <section key={month}>
          <h3>{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long' })}</h3>
          {yearMoments.filter((moment) => moment.date.startsWith(month)).map((moment) => <article className="life-moment-card" key={moment.id}>
            <input className="life-moment-title" value={moment.title} onChange={(event) => updateMoment(moment.id, { title: event.target.value })} />
            <input type="date" value={moment.date} onChange={(event) => updateMoment(moment.id, { date: event.target.value })} />
            <input value={moment.place ?? ''} onChange={(event) => updateMoment(moment.id, { place: event.target.value || undefined })} placeholder="Place (optional)" />
            <textarea rows={2} value={moment.reflection ?? ''} onChange={(event) => updateMoment(moment.id, { reflection: event.target.value || undefined })} placeholder="No reflection needed." />
            <button onClick={() => removeMoment(moment)}>Delete</button>
          </article>)}
        </section>)}</div>
    </article>}

    {tab === 'moments' && <article className="card life-create-card">
        <div className="card-heading"><div><span className="number">01</span><h2>Record a moment</h2></div></div>
        <p className="life-gentle-copy">A title and date are enough. Everything else is optional.</p>
        <form className="life-moment-form" onSubmit={addMoment}>
          <input value={newMoment.title} onChange={(event) => setNewMoment((current) => ({ ...current, title: event.target.value }))} placeholder="What happened?" />
          <input type="date" value={newMoment.date} onChange={(event) => setNewMoment((current) => ({ ...current, date: event.target.value }))} />
          <input value={newMoment.place} onChange={(event) => setNewMoment((current) => ({ ...current, place: event.target.value }))} placeholder="Place (optional)" />
          <textarea rows={4} value={newMoment.reflection} onChange={(event) => setNewMoment((current) => ({ ...current, reflection: event.target.value }))} placeholder="A few words, if you want…" />
          <button className="primary">Save moment</button>
        </form>
    </article>}

    {tab === 'month' && <section className="card life-month-manager">
      <div className="card-heading"><div><span className="number">01</span><h2>Life this month</h2></div><input aria-label="Life month" type="month" value={lifeMonth} onChange={(event) => setLifeMonth(event.target.value)} /></div>
      <p className="life-gentle-copy">Recurring invitations return with a fresh state each month. Nothing unfinished becomes overdue.</p>
      <form className="life-month-create" onSubmit={addMonthlyItem}>
        <input value={newMonthlyTitle} onChange={(event) => setNewMonthlyTitle(event.target.value)} placeholder="Something that might bring colour to life" />
        <label><input type="checkbox" checked={newMonthlyRepeats} onChange={(event) => setNewMonthlyRepeats(event.target.checked)} /> Show every month</label>
        <button className="primary">Add invitation</button>
      </form>
      {sourceDraft?.kind === 'monthly' && sourceMomentForm}
      {monthlyItems.length === 0 ? <div className="life-empty-state"><strong>No invitations for this month.</strong><span>Nothing is missing and nothing is overdue.</span></div> : <div className="life-manager-list">{monthlyItems.map((item) => {
        const moment = data.lifeMoments.find((entry) => entry.source === 'monthly' && entry.sourceId === item.id && entry.date.startsWith(lifeMonth))
        const scheduledEvent = data.calendarEvents.find((event) => event.lifeItemId === item.id && event.date.startsWith(lifeMonth))
        return <div className={moment ? 'complete' : ''} key={item.id}>
          <span className="life-list-mark">{moment ? '✓' : '○'}</span>
          <input value={item.title} onChange={(event) => updateMonthlyItem(item.id, { title: event.target.value })} />
          <label className="life-schedule-date"><span>♥ Schedule</span><input type="date" min={`${lifeMonth}-01`} max={lifeMonthLastDate} value={scheduledEvent?.date ?? ''} onChange={(event) => scheduleMonthlyItem(item, event.target.value)} /></label>
          <label><input type="checkbox" checked={item.recursMonthly} onChange={(event) => updateMonthlyItem(item.id, { recursMonthly: event.target.checked, month: event.target.checked ? undefined : lifeMonth })} /> Every month</label>
          {!moment && <button onClick={() => beginSourceMoment('monthly', item.id, item.title, lifeMonth === localMonth() ? localDate() : `${lifeMonth}-01`)}>Record</button>}
          {moment && <span className="life-lived-label">Lived {moment.date}</span>}
          <button className="danger-link" onClick={() => removeMonthlyItem(item)}>Delete</button>
        </div>
      })}</div>}
    </section>}

    {tab === 'dreams' && <section className="card life-dream-manager">
      <div className="card-heading"><div><span className="number">01</span><h2>Someday dreams</h2></div><span className="count-pill">{activeDreams.length} waiting gently</span></div>
      <p className="life-gentle-copy">Capture the thought first. No date, category, budget, or plan is required.</p>
      <form className="life-dream-create" onSubmit={addDream}><input value={newDreamTitle} onChange={(event) => setNewDreamTitle(event.target.value)} placeholder="One day, I would love to…" /><button className="primary">Save dream</button></form>
      {sourceDraft?.kind === 'dream' && sourceMomentForm}
      {data.somedayDreams.length === 0 ? <div className="life-empty-state"><strong>No dreams waiting here.</strong><span>Add one whenever a possibility catches your attention.</span></div> : <div className="life-dream-list">{data.somedayDreams.map((dream) => {
        const realisedMoment = dream.realisedMomentId ? data.lifeMoments.find((moment) => moment.id === dream.realisedMomentId) : undefined
        return <div className={dream.realisedMomentId ? 'complete' : ''} key={dream.id}>
        <input className="life-dream-checkbox" aria-label={dream.realisedMomentId ? `Return ${dream.title} to Someday` : `Record ${dream.title} as lived`} type="checkbox" checked={Boolean(dream.realisedMomentId)} onChange={() => dream.realisedMomentId ? undoDream(dream) : beginSourceMoment('dream', dream.id, dream.title)} />
        <input value={dream.title} onChange={(event) => updateDream(dream.id, event.target.value)} />
        {realisedMoment ? <span className="life-lived-label">Lived {realisedMoment.date}</span> : <span className="life-dream-hint">Check when it becomes a moment</span>}
        <button className="danger-link" onClick={() => removeDream(dream)}>Delete</button>
      </div>})}</div>}
    </section>}
  </>
}

function FocusPage({ data, setData, setNotice }: {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  setNotice: (value: string) => void
}) {
  return <>
    <section className="hero-row focus-hero">
      <div><p className="eyebrow">Focus</p><h1>Keep hold of the thread.</h1><p className="muted">Choose one next action. Park related problems without losing where you started.</p></div>
    </section>
    <FocusCard data={data} setData={setData} setNotice={setNotice} />
  </>
}

function FocusCard({ data, setData, setNotice }: {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  setNotice: (value: string) => void
}) {
  const [title, setTitle] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [minutes, setMinutes] = useState('20')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [projectId, setProjectId] = useState('')
  const [trackerId, setTrackerId] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const plan = data.focusPlan
  const trackers = data.projects.find((item) => item.id === projectId)?.trackers ?? []
  const activeBranch = plan?.branches.find((branch) => branch.id === plan.activeBranchId)

  function createPlan(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !nextAction.trim()) return
    setData((current) => ({
      ...current,
      focusPlan: {
        id: id(),
        title: title.trim(),
        nextAction: nextAction.trim(),
        estimatedMinutes: Math.max(1, Number(minutes) || 20),
        expectedDifficulty: difficulty,
        projectId: projectId || undefined,
        trackerId: trackerId || undefined,
        branches: [],
      },
    }))
  }

  function startFocus() {
    if (!plan || data.activeTimer) return
    setData((current) => ({
      ...current,
      activeTimer: {
        startedAt: new Date().toISOString(),
        title: activeBranch?.title ?? plan.nextAction,
        category: 'Core Work',
        projectId: plan.projectId,
        trackerId: plan.trackerId,
        isEvidence: true,
        expectedMinutes: plan.estimatedMinutes,
        expectedDifficulty: plan.expectedDifficulty,
        focusId: plan.id,
        branchId: activeBranch?.id,
      },
    }))
  }

  function addBranch(event: FormEvent) {
    event.preventDefault()
    if (!plan || !branchTitle.trim()) return
    setData((current) => ({
      ...current,
      focusPlan: current.focusPlan && {
        ...current.focusPlan,
        branches: [...current.focusPlan.branches, { id: id(), title: branchTitle.trim(), status: 'parked', createdAt: new Date().toISOString() }],
      },
    }))
    setBranchTitle('')
    setNotice('Branch parked. Your original task is still in view.')
  }

  function activateBranch(branchId: string) {
    setData((current) => ({
      ...current,
      focusPlan: current.focusPlan && {
        ...current.focusPlan,
        activeBranchId: branchId,
        branches: current.focusPlan.branches.map((branch) => ({
          ...branch,
          status: branch.id === branchId ? 'active' : branch.status === 'active' ? 'parked' : branch.status,
        })),
      },
    }))
  }

  function completeBranch(branchId: string) {
    setData((current) => ({
      ...current,
      focusPlan: current.focusPlan && {
        ...current.focusPlan,
        activeBranchId: current.focusPlan.activeBranchId === branchId ? undefined : current.focusPlan.activeBranchId,
        branches: current.focusPlan.branches.map((branch) => branch.id === branchId ? { ...branch, status: 'done', completedAt: new Date().toISOString() } : branch),
      },
    }))
    setNotice(`Branch complete. Return to: ${plan?.nextAction ?? 'your original task'}`)
  }

  function finishPlan() {
    if (!plan) return
    setData((current) => ({
      ...current,
      focusPlan: undefined,
      manualDone: [{ id: id(), title: plan.title, date: localDate() }, ...current.manualDone],
    }))
    setNotice('Focus task completed and added to Done This Week.')
  }

  return <article className="card focus-card">
    <div className="card-heading"><div><span className="number">01</span><h2>Focus path</h2></div><span className="status-dot">Don’t lose the thread</span></div>
    {!plan ? <form className="focus-setup" onSubmit={createPlan}>
      <div className="focus-intro"><strong>Make the first step smaller than the whole task.</strong><p>This is a temporary working thread, not another permanent task list.</p></div>
      <label>What are you trying to move?<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Finish course report" required /></label>
      <label>What is the next visible action?<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="e.g. Draft the case analysis paragraph" required /></label>
      <div className="focus-fields">
        <label>Expected minutes<input type="number" min="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        <label>Feels<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}><option value="easy">Light</option><option value="medium">Some effort</option><option value="hard">Hard to start</option></select></label>
        <label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setTrackerId('') }}><option value="">No project</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <label>Progress item<select value={trackerId} disabled={!projectId} onChange={(event) => setTrackerId(event.target.value)}><option value="">None</option>{trackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.title}</option>)}</select></label>
      </div>
      <button className="primary">Set focus path</button>
    </form> : <div className="focus-active">
      <div className="focus-main">
        <p className="focus-root">Original task <strong>{plan.title}</strong></p>
        {activeBranch && <div className="breadcrumb"><span>{plan.title}</span><b>→</b><strong>{activeBranch.title}</strong></div>}
        <div className="next-action-block"><span>{activeBranch ? 'Intentional branch' : 'Next action'}</span><h3>{activeBranch?.title ?? plan.nextAction}</h3><p>{plan.estimatedMinutes ? `About ${plan.estimatedMinutes} minutes` : 'No time estimate'} · {plan.expectedDifficulty === 'hard' ? 'Feels hard to start' : plan.expectedDifficulty === 'easy' ? 'Feels light' : 'Some effort expected'}</p></div>
        <div className="focus-actions"><button className="primary" disabled={Boolean(data.activeTimer)} onClick={startFocus}>▶ Start this step</button>{activeBranch ? <button className="secondary" onClick={() => completeBranch(activeBranch.id)}>✓ Finish branch & return</button> : <button className="secondary" onClick={finishPlan}>✓ Finish task</button>}<button className="text-button" onClick={() => { if (window.confirm('Clear this focus path? Parked branches will also be removed.')) setData((current) => ({ ...current, focusPlan: undefined })) }}>Clear</button></div>
      </div>
      <aside className="branch-panel">
        <p className="eyebrow">Something else appeared?</p>
        <form className="branch-form" onSubmit={addBranch}><input value={branchTitle} onChange={(event) => setBranchTitle(event.target.value)} placeholder="Capture it without switching" /><button>Park</button></form>
        <div className="branch-list">{plan.branches.filter((branch) => branch.status !== 'done').map((branch) => <div className={branch.status === 'active' ? 'active' : ''} key={branch.id}><span><i />{branch.title}</span>{branch.status === 'active' ? <button onClick={() => completeBranch(branch.id)}>Done</button> : <button onClick={() => activateBranch(branch.id)}>Switch intentionally</button>}</div>)}</div>
        {plan.branches.length === 0 && <p className="branch-empty">Park related problems here. You can return to them without abandoning the original task.</p>}
      </aside>
    </div>}
  </article>
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <div className="empty"><div className="empty-mark">○</div><strong>{title}</strong><p>{detail}</p><button className="secondary" onClick={onAction}>{action}</button></div>
}

function TimerBar({ data, setData, setNotice, onStopped }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; setNotice: (value: string) => void; onStopped: (activityId: string) => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(interval)
  }, [])
  const timer = data.activeTimer!
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000))
  const display = `${String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(elapsedSeconds % 3600 / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`

  function stopTimer() {
    const minutes = Math.max(1, Math.round(elapsedSeconds / 60))
    const activity: Activity = { id: id(), title: timer.title, date: localDate(), durationMinutes: minutes, category: timer.category, projectId: timer.projectId, trackerId: timer.trackerId, isEvidence: timer.isEvidence, expectedMinutes: timer.expectedMinutes, expectedDifficulty: timer.expectedDifficulty }
    setData((current) => ({ ...current, activities: [activity, ...current.activities], activeTimer: undefined }))
    setNotice(`Saved ${formatMinutes(minutes)} for “${timer.title}”`)
    if (timer.expectedMinutes || timer.expectedDifficulty) onStopped(activity.id)
  }

  return <div className="timer-bar"><span className="pulse" /><strong>{timer.title}</strong><span>{timer.category}</span><time>{display}</time><button onClick={stopTimer}>■ Stop & save</button></div>
}

function ReflectionDialog({ activityId, setData, close }: { activityId: string; setData: React.Dispatch<React.SetStateAction<AppData>>; close: () => void }) {
  function save(value: ActualDifficulty) {
    setData((current) => ({ ...current, activities: current.activities.map((activity) => activity.id === activityId ? { ...activity, actualDifficulty: value } : activity) }))
    close()
  }
  return <div className="modal-backdrop">
    <section className="modal reflection-modal" role="dialog" aria-modal="true" aria-labelledby="reflection-title">
      <p className="eyebrow">One-tap reflection</p>
      <h2 id="reflection-title">How was it compared with what you expected?</h2>
      <p className="muted">This is evidence for future you, not a score.</p>
      <div className="reflection-options"><button onClick={() => save('easier')}>Easier</button><button onClick={() => save('as-expected')}>About right</button><button onClick={() => save('harder')}>Harder</button></div>
      <button className="text-button" onClick={close}>Skip</button>
    </section>
  </div>
}

function LogDialog({ data, setData, close }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; close: () => void }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(localDate())
  const [duration, setDuration] = useState('30')
  const [category, setCategory] = useState<Category>('Core Work')
  const [projectId, setProjectId] = useState('')
  const [trackerId, setTrackerId] = useState('')
  const [notes, setNotes] = useState('')
  const [isEvidence, setEvidence] = useState(true)
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const trackers = data.projects.find((item) => item.id === projectId)?.trackers ?? []

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const activity: Activity = { id: id(), title: title.trim(), date, durationMinutes: Math.max(0, Number(duration) || 0), category, projectId: projectId || undefined, trackerId: trackerId || undefined, notes: notes.trim() || undefined, isEvidence }
    setData((current) => ({ ...current, activities: [activity, ...current.activities] }))
    close()
  }

  function startTimer() {
    if (!title.trim()) return
    setData((current) => ({ ...current, activeTimer: { startedAt: new Date().toISOString(), title: title.trim(), category, projectId: projectId || undefined, trackerId: trackerId || undefined, isEvidence, expectedMinutes: Math.max(1, Number(duration) || 30), expectedDifficulty: difficulty } }))
    close()
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="modal" role="dialog" aria-modal="true">
      <div className="modal-heading"><div><p className="eyebrow">Daily log</p><h2>Make the work visible</h2></div><button className="close" onClick={close}>×</button></div>
      <form onSubmit={submit} className="form-grid">
        <label className="full">What did you do?<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Networking exam review" required /></label>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setTrackerId('') }}><option value="">No project</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Progress item<select value={trackerId} disabled={!projectId} onChange={(event) => setTrackerId(event.target.value)}><option value="">None</option>{trackers.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Minutes / expected minutes<input type="number" min="0" step="5" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
        <label>Before starting, it feels<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}><option value="easy">Light</option><option value="medium">Some effort</option><option value="hard">Hard to start</option></select></label>
        <label className="full">Notes (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} /></label>
        <label className="check-label full"><input type="checkbox" checked={isEvidence} onChange={(event) => setEvidence(event.target.checked)} /> Add this to Done This Week</label>
        <div className="form-actions full"><button type="button" className="secondary" disabled={Boolean(data.activeTimer)} onClick={startTimer}>▶ Start timer</button><button className="primary">Save activity</button></div>
      </form>
    </section>
  </div>
}

function RoutineManager({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [dailyTitle, setDailyTitle] = useState('')
  const [weeklyTitle, setWeeklyTitle] = useState('')
  const [weeklyTarget, setWeeklyTarget] = useState('2')
  const [historyDate, setHistoryDate] = useState(localDate())
  const [essentialTitle, setEssentialTitle] = useState('')
  type ReorderGroup = 'daily' | 'weekly' | 'essential'
  const [draggedItem, setDraggedItem] = useState<{ id: string; group: ReorderGroup }>()
  const draggedItemRef = useRef<{ id: string; group: ReorderGroup }>()
  const [dropTarget, setDropTarget] = useState<{ id: string; group: ReorderGroup; position: 'before' | 'after' }>()

  function addDailyRoutine(event: FormEvent) {
    event.preventDefault()
    if (!dailyTitle.trim()) return
    setData((current) => ({ ...current, routineTasks: [...current.routineTasks, { id: id(), title: dailyTitle.trim(), frequency: 'daily' }] }))
    setDailyTitle('')
  }

  function addWeeklyRoutine(event: FormEvent) {
    event.preventDefault()
    if (!weeklyTitle.trim()) return
    setData((current) => ({ ...current, routineTasks: [...current.routineTasks, { id: id(), title: weeklyTitle.trim(), frequency: 'weekly', weeklyTarget: Math.max(1, Number(weeklyTarget) || 1) }] }))
    setWeeklyTitle('')
  }

  function updateRoutine(taskId: string, patch: Partial<RoutineTask>) {
    setData((current) => ({ ...current, routineTasks: current.routineTasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) }))
  }

  function addEssential(event: FormEvent) {
    event.preventDefault()
    const title = essentialTitle.trim()
    if (!title) return
    setData((current) => ({ ...current, essentialTasks: [...current.essentialTasks, { id: id(), title }] }))
    setEssentialTitle('')
  }

  function updateEssential(taskId: string, title: string) {
    setData((current) => ({ ...current, essentialTasks: current.essentialTasks.map((task) => task.id === taskId ? { ...task, title } : task) }))
  }

  function removeEssential(taskId: string) {
    setData((current) => ({ ...current, essentialTasks: current.essentialTasks.filter((task) => task.id !== taskId), essentialCompletions: current.essentialCompletions.filter((item) => item.taskId !== taskId) }))
  }

  function removeRoutine(task: RoutineTask) {
    if (!window.confirm(`Delete “${task.title}” and all of its completion records?`)) return
    setData((current) => ({
      ...current,
      routineTasks: current.routineTasks.filter((item) => item.id !== task.id),
      routineCompletions: current.routineCompletions.filter((item) => item.taskId !== task.id),
    }))
  }

  function reorderItem(group: ReorderGroup, targetId: string, position: 'before' | 'after') {
    const activeDrag = draggedItemRef.current ?? draggedItem
    if (!activeDrag || activeDrag.group !== group || activeDrag.id === targetId) {
      draggedItemRef.current = undefined
      setDraggedItem(undefined)
      setDropTarget(undefined)
      return
    }
    setData((current) => {
      if (group === 'essential') {
        const moving = current.essentialTasks.find((task) => task.id === activeDrag.id)
        if (!moving) return current
        const reordered = current.essentialTasks.filter((task) => task.id !== activeDrag.id)
        const targetIndex = reordered.findIndex((task) => task.id === targetId)
        if (targetIndex < 0) return current
        reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moving)
        return { ...current, essentialTasks: reordered }
      }

      const frequency = group === 'daily' ? 'daily' : 'weekly'
      const moving = current.routineTasks.find((task) => task.id === activeDrag.id && task.frequency === frequency)
      if (!moving) return current
      const reorderedGroup = current.routineTasks.filter((task) => task.frequency === frequency && task.id !== activeDrag.id)
      const targetIndex = reorderedGroup.findIndex((task) => task.id === targetId)
      if (targetIndex < 0) return current
      reorderedGroup.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moving)
      let groupIndex = 0
      return {
        ...current,
        routineTasks: current.routineTasks.map((task) => task.frequency === frequency ? reorderedGroup[groupIndex++] : task),
      }
    })
    draggedItemRef.current = undefined
    setDraggedItem(undefined)
    setDropTarget(undefined)
  }

  function reorderEvents(group: ReorderGroup, taskId: string) {
    return {
      onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
        if (!draggedItem || draggedItem.group !== group || draggedItem.id === taskId) return
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' as const : 'after' as const
        setDropTarget({ id: taskId, group, position })
      },
      onDrop: (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        reorderItem(group, taskId, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after')
      },
    }
  }

  function dragHandle(group: ReorderGroup, taskId: string, title: string) {
    return <span
      className="drag-handle"
      draggable
      role="button"
      tabIndex={0}
      aria-label={`Drag to reorder ${title}`}
      title="Drag to reorder"
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', taskId)
        const activeDrag = { id: taskId, group }
        draggedItemRef.current = activeDrag
        setDraggedItem(activeDrag)
      }}
      onDragEnd={() => { draggedItemRef.current = undefined; setDraggedItem(undefined); setDropTarget(undefined) }}
    ><span className="drag-grip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span><span>Drag</span></span>
  }

  function reorderClass(group: ReorderGroup, taskId: string) {
    const targetClass = dropTarget?.group === group && dropTarget.id === taskId ? ` drop-${dropTarget.position}` : ''
    return `reorderable-definition${draggedItem?.group === group && draggedItem.id === taskId ? ' dragging' : ''}${targetClass}`
  }

  function dailyComplete(taskId: string) {
    return data.routineCompletions.some((item) => item.taskId === taskId && item.date === historyDate)
  }

  function toggleDailyHistory(taskId: string) {
    setData((current) => {
      const completed = current.routineCompletions.some((item) => item.taskId === taskId && item.date === historyDate)
      return { ...current, routineCompletions: completed
        ? current.routineCompletions.filter((item) => !(item.taskId === taskId && item.date === historyDate))
        : [...current.routineCompletions, { id: id(), taskId, date: historyDate }] }
    })
  }

  function dailyWeeklyCount(taskId: string) {
    return data.routineCompletions.filter((item) => item.taskId === taskId && item.date === historyDate).length
  }

  function selectedWeekCount(taskId: string) {
    const selected = new Date(`${historyDate}T00:00:00`)
    const monday = new Date(selected)
    monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7))
    return data.routineCompletions.filter((item) => item.taskId === taskId && dateInWeek(item.date, monday)).length
  }

  function changeWeeklyHistory(task: RoutineTask, amount: 1 | -1) {
    setData((current) => {
      if (amount === 1) {
        const selected = new Date(`${historyDate}T00:00:00`)
        const monday = new Date(selected)
        monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7))
        const weekCount = current.routineCompletions.filter((item) => item.taskId === task.id && dateInWeek(item.date, monday)).length
        if (weekCount >= (task.weeklyTarget ?? 1)) return current
        return { ...current, routineCompletions: [...current.routineCompletions, { id: id(), taskId: task.id, date: historyDate }] }
      }
      const match = [...current.routineCompletions].reverse().find((item) => item.taskId === task.id && item.date === historyDate)
      return match ? { ...current, routineCompletions: current.routineCompletions.filter((item) => item.id !== match.id) } : current
    })
  }

  function moveHistoryDate(offset: number) {
    const date = new Date(`${historyDate}T00:00:00`)
    date.setDate(date.getDate() + offset)
    setHistoryDate(localDate(date))
  }

  const daily = data.routineTasks.filter((task) => task.frequency === 'daily')
  const weekly = data.routineTasks.filter((task) => task.frequency === 'weekly')

  return <>
    <section className="hero-row routines-hero"><div><p className="eyebrow">Routines</p><h1>Manage what repeats.</h1><p className="muted">Daily tasks reset each day. Weekly tasks have a flexible target — complete them on any day you choose.</p></div></section>
    <section className="routine-manager-grid">
      <article className="card routine-manager-group">
        <div className="card-heading"><div><span className="number">01</span><h2>Daily tasks</h2></div><span className="count-pill">{daily.length} tasks</span></div>
        <p className="routine-manager-detail">One check per day. Each new day starts unchecked.</p>
        <form className="routine-group-create" onSubmit={addDailyRoutine}><input value={dailyTitle} onChange={(event) => setDailyTitle(event.target.value)} placeholder="New daily task" /><button className="primary">Add daily</button></form>
        {daily.length === 0 ? <p className="quiet">No daily tasks yet.</p> : <div className="routine-manager-list">{daily.map((task) => <div className={`daily-definition ${reorderClass('daily', task.id)}`} key={task.id} {...reorderEvents('daily', task.id)}>
          {dragHandle('daily', task.id, task.title)}
          <input aria-label={`${task.title} name`} value={task.title} onChange={(event) => updateRoutine(task.id, { title: event.target.value })} />
          <button aria-label={`Delete ${task.title}`} onClick={() => removeRoutine(task)}>Delete</button>
        </div>)}</div>}
      </article>
      <article className="card routine-manager-group">
        <div className="card-heading"><div><span className="number">02</span><h2>Weekly targets</h2></div><span className="count-pill">{weekly.length} tasks</span></div>
        <p className="routine-manager-detail">Set how many times per week. No fixed weekday is required.</p>
        <form className="routine-group-create weekly-create" onSubmit={addWeeklyRoutine}><input value={weeklyTitle} onChange={(event) => setWeeklyTitle(event.target.value)} placeholder="New weekly task" /><label><input type="number" min="1" value={weeklyTarget} onChange={(event) => setWeeklyTarget(event.target.value)} /><span>times / week</span></label><button className="primary">Add weekly</button></form>
        {weekly.length === 0 ? <p className="quiet">No weekly targets yet.</p> : <div className="routine-manager-list">{weekly.map((task) => <div className={`weekly-definition ${reorderClass('weekly', task.id)}`} key={task.id} {...reorderEvents('weekly', task.id)}>
          {dragHandle('weekly', task.id, task.title)}
          <input aria-label={`${task.title} name`} value={task.title} onChange={(event) => updateRoutine(task.id, { title: event.target.value })} />
          <label><input aria-label={`${task.title} target per week`} type="number" min="1" value={task.weeklyTarget ?? 1} onChange={(event) => updateRoutine(task.id, { weeklyTarget: Math.max(1, Number(event.target.value) || 1) })} /><span>/ week</span></label>
          <button aria-label={`Delete ${task.title}`} onClick={() => removeRoutine(task)}>Delete</button>
        </div>)}</div>}
      </article>
    </section>
    <article className="card essentials-manager-card">
      <div className="card-heading"><div><span className="number">03</span><h2>Daily essentials</h2></div><span className="count-pill">{data.essentialTasks.length} essentials</span></div>
      <p className="routine-manager-detail">A small daily finish line. Completing every item reveals the “enough for today” banner.</p>
      <form className="routine-group-create" onSubmit={addEssential}><input value={essentialTitle} onChange={(event) => setEssentialTitle(event.target.value)} placeholder="e.g. IELTS study" /><button className="primary">Add essential</button></form>
      {data.essentialTasks.length === 0 ? <p className="quiet">No essentials yet.</p> : <div className="routine-manager-list">{data.essentialTasks.map((task) => <div className={`daily-definition ${reorderClass('essential', task.id)}`} key={task.id} {...reorderEvents('essential', task.id)}>{dragHandle('essential', task.id, task.title)}<input value={task.title} onChange={(event) => updateEssential(task.id, event.target.value)} /><button onClick={() => removeEssential(task.id)}>Delete</button></div>)}</div>}
    </article>
    <article className="card routine-history-card">
      <div className="card-heading history-heading"><div><span className="number">04</span><h2>Daily record</h2></div><div className="history-date-controls"><button aria-label="Previous day" onClick={() => moveHistoryDate(-1)}>‹</button><input aria-label="Record date" type="date" max={localDate()} value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} /><button aria-label="Next day" disabled={historyDate >= localDate()} onClick={() => moveHistoryDate(1)}>›</button><button onClick={() => setHistoryDate(localDate())}>Today</button></div></div>
      <p className="routine-manager-detail">Backfill a forgotten check or correct an earlier day. Every change updates the Dashboard activity map.</p>
      <div className="history-groups">
        <section><h3>Daily tasks</h3>{daily.length === 0 ? <p className="quiet">No daily tasks.</p> : <div className="history-list">{daily.map((task) => <label className={dailyComplete(task.id) ? 'complete' : ''} key={task.id}><input type="checkbox" checked={dailyComplete(task.id)} onChange={() => toggleDailyHistory(task.id)} /><span>{task.title}<small>{dailyComplete(task.id) ? 'Completed' : historyDate < localDate() ? 'Not completed' : 'Not yet completed'}</small></span></label>)}</div>}</section>
        <section><h3>Weekly task entries</h3>{weekly.length === 0 ? <p className="quiet">No weekly tasks.</p> : <div className="history-list weekly-history">{weekly.map((task) => {
          const dayCount = dailyWeeklyCount(task.id)
          const weekCount = selectedWeekCount(task.id)
          const target = task.weeklyTarget ?? 1
          return <div className={weekCount >= target ? 'complete' : ''} key={task.id}><span>{task.title}<small>{dayCount} on this day · {weekCount}/{target} in this week</small></span><div><button disabled={dayCount === 0} onClick={() => changeWeeklyHistory(task, -1)}>−</button><strong>{dayCount}</strong><button disabled={weekCount >= target} onClick={() => changeWeeklyHistory(task, 1)}>+</button></div></div>
        })}</div>}</section>
      </div>
    </article>
  </>
}

function BoardsPage({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [selectedBoardId, setSelectedBoardId] = useState(data.boards[0]?.id ?? '')
  const [boardTitle, setBoardTitle] = useState('')
  const [template, setTemplate] = useState<'matrix' | 'custom'>('matrix')
  const [columnTitle, setColumnTitle] = useState('')
  const [newItems, setNewItems] = useState<Record<string, string>>({})
  const [draggedBoardId, setDraggedBoardId] = useState<string>()
  const draggedBoardRef = useRef<string>()
  const [boardDropTarget, setBoardDropTarget] = useState<{ id: string; position: 'before' | 'after' }>()
  const [draggedItemId, setDraggedItemId] = useState<string>()
  const board = data.boards.find((item) => item.id === selectedBoardId) ?? data.boards[0]

  useEffect(() => {
    if (!board && data.boards[0]) setSelectedBoardId(data.boards[0].id)
  }, [board, data.boards])

  function updateBoard(boardId: string, updater: (board: LifeBoard) => LifeBoard) {
    setData((current) => ({ ...current, boards: current.boards.map((item) => item.id === boardId ? updater(item) : item) }))
  }

  function addBoard(event: FormEvent) {
    event.preventDefault()
    const title = boardTitle.trim()
    if (!title) return
    const columns = template === 'matrix'
      ? ['Important & urgent', 'Important, not urgent', 'Urgent, not important', 'Neither urgent nor important'].map((name) => ({ id: id(), title: name }))
      : [{ id: id(), title: 'Inbox' }]
    const next: LifeBoard = { id: id(), title, columns, items: [] }
    setData((current) => ({ ...current, boards: [...current.boards, next] }))
    setSelectedBoardId(next.id)
    setBoardTitle('')
  }

  function removeBoard(target: LifeBoard) {
    if (!window.confirm(`Delete “${target.title}” and all of its items? This cannot be undone.`)) return
    setData((current) => ({ ...current, boards: current.boards.filter((item) => item.id !== target.id) }))
    setSelectedBoardId(data.boards.find((item) => item.id !== target.id)?.id ?? '')
  }

  function addColumn(event: FormEvent) {
    event.preventDefault()
    if (!board || !columnTitle.trim()) return
    updateBoard(board.id, (current) => ({ ...current, columns: [...current.columns, { id: id(), title: columnTitle.trim() }] }))
    setColumnTitle('')
  }

  function removeColumn(columnId: string) {
    if (!board) return
    const column = board.columns.find((item) => item.id === columnId)
    const count = board.items.filter((item) => item.columnId === columnId).length
    const itemText = count > 0 ? ` and its ${count} item${count === 1 ? '' : 's'}` : ''
    if (!window.confirm(`Delete column “${column?.title ?? 'Untitled'}”${itemText}? This cannot be undone.`)) return
    updateBoard(board.id, (current) => ({ ...current, columns: current.columns.filter((column) => column.id !== columnId), items: current.items.filter((item) => item.columnId !== columnId) }))
  }

  function removeItem(item: BoardItem) {
    if (!board || !window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return
    updateBoard(board.id, (current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }))
  }

  function reorderBoards(targetBoardId: string, position: 'before' | 'after') {
    const activeBoardId = draggedBoardRef.current ?? draggedBoardId
    if (!activeBoardId || activeBoardId === targetBoardId) return
    setData((current) => {
      const moving = current.boards.find((item) => item.id === activeBoardId)
      if (!moving) return current
      const remaining = current.boards.filter((item) => item.id !== activeBoardId)
      const targetIndex = remaining.findIndex((item) => item.id === targetBoardId)
      if (targetIndex < 0) return current
      remaining.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moving)
      return { ...current, boards: remaining }
    })
    draggedBoardRef.current = undefined
    setDraggedBoardId(undefined)
    setBoardDropTarget(undefined)
  }

  function addItem(event: FormEvent, columnId: string) {
    event.preventDefault()
    if (!board) return
    const title = (newItems[columnId] ?? '').trim()
    if (!title) return
    const item: BoardItem = { id: id(), title, columnId }
    updateBoard(board.id, (current) => ({ ...current, items: [...current.items, item] }))
    setNewItems((current) => ({ ...current, [columnId]: '' }))
  }

  function moveItem(columnId: string, beforeItemId?: string) {
    if (!board || !draggedItemId) return
    updateBoard(board.id, (current) => {
      const moving = current.items.find((item) => item.id === draggedItemId)
      if (!moving) return current
      const remaining = current.items.filter((item) => item.id !== draggedItemId)
      const moved = { ...moving, columnId }
      if (beforeItemId) {
        const index = remaining.findIndex((item) => item.id === beforeItemId)
        if (index >= 0) remaining.splice(index, 0, moved)
        else remaining.push(moved)
      } else {
        const lastIndex = remaining.reduce((result, item, index) => item.columnId === columnId ? index : result, -1)
        remaining.splice(lastIndex + 1, 0, moved)
      }
      return { ...current, items: remaining }
    })
    setDraggedItemId(undefined)
  }

  return <>
    <section className="hero-row boards-hero"><div><p className="eyebrow">Boards</p><h1>Keep flexible things visible.</h1><p className="muted">Independent lists for temporary errands, ideas, and things you may choose when there is space.</p></div></section>
    <article className="card board-create-card"><form onSubmit={addBoard}><input value={boardTitle} onChange={(event) => setBoardTitle(event.target.value)} placeholder="New board name" /><select value={template} onChange={(event) => setTemplate(event.target.value as 'matrix' | 'custom')}><option value="matrix">Priority matrix</option><option value="custom">Custom board</option></select><button className="primary">Create board</button></form></article>
    {data.boards.length === 0 ? <article className="card"><div className="motto-list-empty"><strong>No boards yet.</strong><span>Create a priority matrix or a custom collection above.</span></div></article> : <>
      <div className="board-tabs">{data.boards.map((item) => <button
        className={`${item.id === board?.id ? 'active' : ''}${draggedBoardId === item.id ? ' dragging' : ''}${boardDropTarget?.id === item.id ? ` drop-${boardDropTarget.position}` : ''}`}
        draggable
        key={item.id}
        onClick={() => setSelectedBoardId(item.id)}
        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); draggedBoardRef.current = item.id; setDraggedBoardId(item.id) }}
        onDragOver={(event) => { event.preventDefault(); const activeBoardId = draggedBoardRef.current ?? draggedBoardId; if (!activeBoardId || activeBoardId === item.id) return; const bounds = event.currentTarget.getBoundingClientRect(); setBoardDropTarget({ id: item.id, position: event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after' }) }}
        onDrop={(event) => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); reorderBoards(item.id, event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after') }}
        onDragEnd={() => { draggedBoardRef.current = undefined; setDraggedBoardId(undefined); setBoardDropTarget(undefined) }}
      ><span className="board-tab-drag" aria-hidden="true">⠿</span><span>{item.title}</span><small>{item.items.filter((entry) => !entry.completedAt).length}</small></button>)}</div>
      {board && <section className="board-workspace">
        <div className="board-toolbar"><input value={board.title} onChange={(event) => updateBoard(board.id, (current) => ({ ...current, title: event.target.value }))} /><form onSubmit={addColumn}><input value={columnTitle} onChange={(event) => setColumnTitle(event.target.value)} placeholder="New column" /><button>Add column</button></form><button className="danger-text" onClick={() => removeBoard(board)}>Delete board</button></div>
        <div className="board-columns">{board.columns.map((column) => {
          const items = board.items.filter((item) => item.columnId === column.id)
          return <article className="board-column" key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={() => moveItem(column.id)}>
            <div className="board-column-heading"><input value={column.title} onChange={(event) => updateBoard(board.id, (current) => ({ ...current, columns: current.columns.map((item) => item.id === column.id ? { ...item, title: event.target.value } : item) }))} /><span>{items.length}</span><button onClick={() => removeColumn(column.id)}>×</button></div>
            <div className="board-items">{items.map((item) => <div className={`board-item ${item.completedAt ? 'complete' : ''}`} draggable key={item.id} onDragStart={() => setDraggedItemId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); moveItem(column.id, item.id) }}>
              <input type="checkbox" checked={Boolean(item.completedAt)} onChange={() => updateBoard(board.id, (current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, completedAt: entry.completedAt ? undefined : localDate() } : entry) }))} />
              <textarea rows={2} value={item.title} onChange={(event) => updateBoard(board.id, (current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, title: event.target.value } : entry) }))} />
              <button onClick={() => removeItem(item)}>×</button>
            </div>)}</div>
            <form className="board-item-create" onSubmit={(event) => addItem(event, column.id)}><input value={newItems[column.id] ?? ''} onChange={(event) => setNewItems((current) => ({ ...current, [column.id]: event.target.value }))} placeholder="Add an item" /><button>＋</button></form>
          </article>
        })}</div>
      </section>}
    </>}
  </>
}

function MottoManager({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [text, setText] = useState('')

  function addMotto(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    const motto: Motto = { id: id(), text: value }
    setData((current) => ({ ...current, mottos: [...current.mottos, motto], mottoDeckSignature: '' }))
    setText('')
  }

  function updateMotto(mottoId: string, value: string) {
    setData((current) => ({ ...current, mottos: current.mottos.map((motto) => motto.id === mottoId ? { ...motto, text: value } : motto) }))
  }

  function removeMotto(motto: Motto) {
    if (!window.confirm(`Delete “${motto.text}”?`)) return
    setData((current) => ({
      ...current,
      mottos: current.mottos.filter((item) => item.id !== motto.id),
      mottoHistory: current.mottoHistory.filter((item) => item.mottoId !== motto.id),
      mottoCycleRemaining: current.mottoCycleRemaining.filter((mottoId) => mottoId !== motto.id),
      mottoDeckSignature: '',
    }))
  }

  return <>
    <section className="hero-row mottos-hero"><div><p className="eyebrow">Mottos</p><h1>Keep the words in view.</h1><p className="muted">One motto appears on the Dashboard each day. Every motto is shown once before the order is shuffled again.</p></div></section>
    <article className="card motto-manager-card">
      <div className="card-heading"><div><span className="number">01</span><h2>Your motto collection</h2></div><span className="count-pill">{data.mottos.length} mottos</span></div>
      <form className="motto-create-form" onSubmit={addMotto}><textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder={'Add a motto…\nLine breaks are preserved. Use **text** for bold.'} /><button className="primary">Add motto</button></form>
      {data.mottos.length === 0 ? <div className="motto-list-empty"><strong>No mottos yet.</strong><span>Move the reminders from your wall into the field above.</span></div> : <div className="motto-manager-list">{data.mottos.map((motto, index) => <div key={motto.id}><span>{String(index + 1).padStart(2, '0')}</span><textarea aria-label={`Motto ${index + 1}`} rows={2} value={motto.text} onChange={(event) => updateMotto(motto.id, event.target.value)} /><button onClick={() => removeMotto(motto)}>Delete</button></div>)}</div>}
      <p className="motto-rule-note"><strong>Formatting:</strong> line breaks and blank lines are preserved. Wrap words in <code>**double asterisks**</code> to make them bold.<br /><strong>Rotation rule:</strong> the app uses every motto once per cycle, in a shuffled order. With at least five mottos, the same one will not appear within the previous four days. A new or deleted motto safely starts a fresh cycle.</p>
    </article>
  </>
}

function Manage({ data, setData, setNotice }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; setNotice: (value: string) => void }) {
  const [projectTitle, setProjectTitle] = useState('')
  const [projectCategoryId, setProjectCategoryId] = useState(data.categories[0]?.id ?? 'study')
  const [categoryTitle, setCategoryTitle] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string>()
  const [editingCategoryId, setEditingCategoryId] = useState<string>()
  const [editingCategoryTitle, setEditingCategoryTitle] = useState('')
  const [draggedProjectId, setDraggedProjectId] = useState<string>()
  const draggedProjectRef = useRef<string>()
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string>()
  const [projectDropTarget, setProjectDropTarget] = useState<{ id: string; position: 'before' | 'after' }>()
  const [doneTitle, setDoneTitle] = useState('')
  const [doneDate, setDoneDate] = useState(localDate())
  const fileRef = useRef<HTMLInputElement>(null)

  function addProject(event: FormEvent) {
    event.preventDefault()
    if (!projectTitle.trim()) return
    const category = data.categories.find((item) => item.id === projectCategoryId) ?? data.categories[0]
    if (!category) return
    const project: Project = {
      id: id(),
      title: projectTitle.trim(),
      description: '',
      color: category.color,
      categoryId: category.id,
      trackers: [{ id: id(), title: 'Deliverables', current: 0, target: 1, tasks: [] }],
      supportWork: [],
    }
    setData((current) => ({ ...current, projects: [...current.projects, project] }))
    setProjectTitle('')
  }

  function addCategory(event: FormEvent) {
    event.preventDefault()
    if (!categoryTitle.trim()) return
    const category: ProjectCategory = { id: id(), title: categoryTitle.trim(), color: COLORS[data.categories.length % COLORS.length] }
    setData((current) => ({ ...current, categories: [...current.categories, category] }))
    setProjectCategoryId(category.id)
    setCategoryTitle('')
  }

  function startEditingCategory(category: ProjectCategory) {
    setEditingCategoryId(category.id)
    setEditingCategoryTitle(category.title)
  }

  function saveCategoryName(event: FormEvent) {
    event.preventDefault()
    const title = editingCategoryTitle.trim()
    if (!editingCategoryId || !title) return
    setData((current) => ({
      ...current,
      categories: current.categories.map((category) => category.id === editingCategoryId ? { ...category, title } : category),
    }))
    setEditingCategoryId(undefined)
    setEditingCategoryTitle('')
  }

  function deleteCategory(category: ProjectCategory) {
    const projectCount = data.projects.filter((project) => project.categoryId === category.id).length
    if (projectCount > 0) {
      setNotice(`Move the ${projectCount} project${projectCount === 1 ? '' : 's'} out of ${category.title} before deleting it`)
      return
    }
    if (data.categories.length === 1) {
      setNotice('Keep at least one category')
      return
    }
    if (!window.confirm(`Delete “${category.title}”?`)) return
    setData((current) => ({ ...current, categories: current.categories.filter((item) => item.id !== category.id) }))
    if (projectCategoryId === category.id) setProjectCategoryId(data.categories.find((item) => item.id !== category.id)?.id ?? '')
    setEditingCategoryId(undefined)
    setEditingCategoryTitle('')
  }

  function moveProject(projectId: string, categoryId: string, targetProjectId?: string, position: 'before' | 'after' = 'after') {
    setData((current) => {
      const category = current.categories.find((item) => item.id === categoryId)
      const moving = current.projects.find((project) => project.id === projectId)
      if (!category || !moving) return current
      const projects = current.projects.filter((project) => project.id !== projectId)
      const moved = { ...moving, categoryId, color: category.color }
      if (targetProjectId) {
        const targetIndex = projects.findIndex((project) => project.id === targetProjectId && project.categoryId === categoryId)
        if (targetIndex >= 0) {
          projects.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved)
          return { ...current, projects }
        }
      }
      const lastCategoryIndex = projects.reduce((result, project, index) => project.categoryId === categoryId ? index : result, -1)
      projects.splice(lastCategoryIndex + 1, 0, moved)
      return { ...current, projects }
    })
  }

  function clearProjectDrag() {
    draggedProjectRef.current = undefined
    setDraggedProjectId(undefined)
    setDragOverCategoryId(undefined)
    setProjectDropTarget(undefined)
  }

  function addTracker(projectId: string, title: string, target: number) {
    if (!title.trim()) return
    setData((current) => ({ ...current, projects: current.projects.map((project) => project.id !== projectId ? project : { ...project, trackers: [...project.trackers, { id: id(), title: title.trim(), current: 0, target: Math.max(1, target), tasks: [] }] }) }))
  }

  function addTask(projectId: string, trackerId: string, title: string, estimateMinutes = 60, parentId?: string) {
    if (!title.trim()) return
    const safeEstimate = Math.max(1, Math.round(estimateMinutes) || 60)
    setData((current) => ({ ...current, projects: current.projects.map((project) => project.id !== projectId ? project : { ...project, trackers: project.trackers.map((tracker) => {
      if (tracker.id !== trackerId) return tracker
      const task: StockTask = { id: id(), title: title.trim(), description: '', completed: false, parentId, estimateMinutes: safeEstimate, remainingEstimateMinutes: safeEstimate, worklogs: [] }
      return { ...tracker, tasks: syncParentTasks([...tracker.tasks, task]) }
    }) }) }))
  }

  function toggleTask(projectId: string, trackerId: string, taskId: string) {
    setData((current) => ({ ...current, projects: current.projects.map((project) => project.id !== projectId ? project : { ...project, trackers: project.trackers.map((tracker) => {
      if (tracker.id !== trackerId) return tracker
      const task = tracker.tasks.find((item) => item.id === taskId)!
      if (tracker.tasks.some((item) => item.parentId === taskId)) return tracker
      const completing = !task.completed
      const tasks = tracker.tasks.map((item) => item.id === taskId ? {
        ...item,
        completed: completing,
        completedAt: completing ? localDate() : undefined,
        remainingEstimateMinutes: completing ? 0 : calculatedRemaining({ ...item, completed: false }),
      } : item)
      return { ...tracker, tasks: syncParentTasks(tasks) }
    }) }) }))
  }

  function addDone(event: FormEvent) {
    event.preventDefault()
    if (!doneTitle.trim()) return
    setData((current) => ({ ...current, manualDone: [{ id: id(), title: doneTitle.trim(), date: doneDate }, ...current.manualDone] }))
    setDoneTitle('')
  }

  async function importFile(file?: File) {
    if (!file) return
    if (!window.confirm('Importing will replace the data currently stored in this browser. Continue?')) return
    try {
      const imported = parseBackup(await file.text())
      setData(imported)
      setNotice('Backup imported successfully')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import backup')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectedProject = data.projects.find((project) => project.id === selectedProjectId)

  return <>
    <section className="hero-row manage-hero"><div><p className="eyebrow">Manage</p><h1>Keep the system factual.</h1><p className="muted">Progress persists. Weekly views are calculated from dated records.</p></div></section>
    <section className="manage-layout">
      <div className="manage-main">
        <article className="card">
          <div className="card-heading"><div><span className="number">01</span><h2>Categories & projects</h2></div><span className="count-pill">Open a project for details</span></div>
          <div className="manage-create-grid">
            <form className="project-create-form" onSubmit={addProject}><input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="New project" /><select aria-label="New project category" value={projectCategoryId} onChange={(event) => setProjectCategoryId(event.target.value)}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}</select><button className="primary">Add project</button></form>
            <form className="category-create-form" onSubmit={addCategory}><input value={categoryTitle} onChange={(event) => setCategoryTitle(event.target.value)} placeholder="New category" /><button className="secondary">Add category</button></form>
          </div>
          <div className="category-manage-list">{data.categories.map((category) => {
            const projects = data.projects.filter((project) => project.categoryId === category.id)
            const isEditing = editingCategoryId === category.id
            return <section
              key={category.id}
              className={`manage-category ${dragOverCategoryId === category.id ? 'drop-target' : ''}`}
              onDragOver={(event) => { event.preventDefault(); if (draggedProjectRef.current ?? draggedProjectId) { setDragOverCategoryId(category.id); setProjectDropTarget(undefined) } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverCategoryId(undefined) }}
              onDrop={(event) => { event.preventDefault(); const activeProjectId = draggedProjectRef.current ?? draggedProjectId; if (activeProjectId) moveProject(activeProjectId, category.id); clearProjectDrag() }}
            >
              {isEditing ? <form className="category-edit-form" onSubmit={saveCategoryName}>
                <i style={{ background: category.color }} />
                <input autoFocus aria-label="Category name" value={editingCategoryTitle} onChange={(event) => setEditingCategoryTitle(event.target.value)} />
                <button className="category-save" aria-label="Save category name">Save</button>
                <button type="button" aria-label="Cancel editing category" onClick={() => setEditingCategoryId(undefined)}>Cancel</button>
                <button type="button" className="category-delete" onClick={() => deleteCategory(category)}>Delete</button>
              </form> : <div className="manage-category-title">
                <button className="category-name-button" onClick={() => startEditingCategory(category)} title="Rename or delete category"><i style={{ background: category.color }} />{category.title}<small>Edit</small></button>
                <small>{projects.length}</small>
              </div>}
              {projects.length === 0 ? <p>No projects yet — drop a project here</p> : projects.map((project) => <div
                className={`manage-project-row${draggedProjectId === project.id ? ' dragging' : ''}${projectDropTarget?.id === project.id ? ` drop-${projectDropTarget.position}` : ''}`}
                key={project.id}
                onDragOver={(event) => {
                  const activeProjectId = draggedProjectRef.current ?? draggedProjectId
                  if (!activeProjectId || activeProjectId === project.id) return
                  event.preventDefault()
                  event.stopPropagation()
                  const bounds = event.currentTarget.getBoundingClientRect()
                  setDragOverCategoryId(category.id)
                  setProjectDropTarget({ id: project.id, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' })
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const activeProjectId = draggedProjectRef.current ?? draggedProjectId
                  if (activeProjectId && activeProjectId !== project.id) {
                    const bounds = event.currentTarget.getBoundingClientRect()
                    moveProject(activeProjectId, category.id, project.id, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after')
                  }
                  clearProjectDrag()
                }}
              >
                <span className="drag-handle project-drag-handle" draggable role="button" tabIndex={0} aria-label={`Drag to reorder ${project.title}`} title="Drag to reorder" onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', project.id); draggedProjectRef.current = project.id; setDraggedProjectId(project.id) }} onDragEnd={clearProjectDrag}><span className="drag-grip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span></span>
                <button className="project-row-main" onClick={() => setSelectedProjectId(project.id)}><span><strong>{project.title}</strong><small>{projectMetrics(project).leafCount} deliverable tasks · {formatMinutes(projectMetrics(project).totalSpent)} invested</small></span></button>
                <b>{projectPercent(project)}%</b>
                <select aria-label={`Move ${project.title} to category`} value={project.categoryId} onChange={(event) => moveProject(project.id, event.target.value)}>{data.categories.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
                <button className="project-row-open" aria-label={`Open ${project.title}`} onClick={() => setSelectedProjectId(project.id)}>›</button>
              </div>)}
            </section>
          })}</div>
        </article>
        <article className="card">
          <div className="card-heading"><div><span className="number">02</span><h2>Recent daily log</h2></div><span className="count-pill">{data.activities.length} records</span></div>
          {data.activities.length === 0 ? <p className="quiet">No activities recorded yet.</p> : <div className="activity-table">{data.activities.slice(0, 30).map((activity) => <div key={activity.id}><time>{activity.date}</time><span><strong>{activity.title}</strong><small>{activity.category}</small></span><b>{formatMinutes(activity.durationMinutes)}</b><button onClick={() => setData((current) => ({ ...current, activities: current.activities.filter((item) => item.id !== activity.id) }))}>×</button></div>)}</div>}
        </article>
      </div>
      <aside>
        <article className="card">
          <div className="card-heading"><div><span className="number">03</span><h2>Manual evidence</h2></div></div>
          <form className="stack-form" onSubmit={addDone}><label>Completed outcome<input value={doneTitle} onChange={(event) => setDoneTitle(event.target.value)} placeholder="e.g. Bank card renewed" /></label><label>Date<input type="date" value={doneDate} onChange={(event) => setDoneDate(event.target.value)} /></label><button className="primary">Add to Done</button></form>
          {data.manualDone.length > 0 && <div className="manual-list">{data.manualDone.slice(0, 8).map((item) => <div key={item.id}><span><strong>{item.title}</strong><small>{item.date}</small></span><button aria-label={`Delete ${item.title}`} onClick={() => setData((current) => ({ ...current, manualDone: current.manualDone.filter((entry) => entry.id !== item.id) }))}>×</button></div>)}</div>}
        </article>
        <article className="card">
          <div className="card-heading"><div><span className="number">04</span><h2>Backup</h2></div></div>
          <p className="quiet">JSON restores the whole app. CSV opens your activity log in a spreadsheet.</p>
          <div className="backup-actions"><button className="secondary" onClick={() => downloadJson(data)}>Export JSON</button><button className="secondary" onClick={() => downloadCsv(data)}>Export CSV</button><button className="secondary" onClick={() => fileRef.current?.click()}>Import JSON</button><input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => importFile(event.target.files?.[0])} /></div>
        </article>
      </aside>
    </section>
    {selectedProject && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProjectId(undefined) }}><aside className="project-drawer" role="dialog" aria-modal="true" aria-label={`${selectedProject.title} details`}><div className="drawer-header"><div><p className="eyebrow">Project details</p><h2>{selectedProject.title}</h2></div><button aria-label="Close project details" onClick={() => setSelectedProjectId(undefined)}>×</button></div><ProjectEditor project={selectedProject} categories={data.categories} addTracker={addTracker} addTask={addTask} toggleTask={toggleTask} setData={setData} /></aside></div>}
  </>
}

function ProjectEditorLegacy({ project, categories, addTracker, addTask, toggleTask, setData }: {
  project: Project
  categories: ProjectCategory[]
  addTracker: (projectId: string, title: string, target: number) => void
  addTask: (projectId: string, trackerId: string, title: string, estimateMinutes?: number, parentId?: string) => void
  toggleTask: (projectId: string, trackerId: string, taskId: string) => void
  setData: React.Dispatch<React.SetStateAction<AppData>>
}) {
  const [trackerTitle, setTrackerTitle] = useState('')
  const [target, setTarget] = useState('1')
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({})

  function setTrackerNumbers(trackerId: string, nextCurrent: number, nextTarget: number) {
    const safeTarget = Math.max(1, Number.isFinite(nextTarget) ? Math.round(nextTarget) : 1)
    const safeCurrent = Math.max(0, Math.min(safeTarget, Number.isFinite(nextCurrent) ? Math.round(nextCurrent) : 0))
    setData((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id !== project.id ? item : {
        ...item,
        trackers: item.trackers.map((entry) => entry.id !== trackerId ? entry : { ...entry, current: safeCurrent, target: safeTarget }),
      }),
    }))
  }

  return <section className="project-editor drawer-editor">
    <div className="project-meta-editor"><label>Project name<input value={project.title} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, title: event.target.value } : item) }))} /></label><label>Category<select value={project.categoryId} onChange={(event) => { const category = categories.find((item) => item.id === event.target.value); setData((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, categoryId: event.target.value, color: category?.color ?? item.color } : item) })) }}>{categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}</select></label><div className="project-percent-preview"><span>Project progress</span><strong>{projectPercent(project)}%</strong><small>Average of {project.trackers.length} progress items</small></div></div>
    {project.trackers.map((tracker) => <div className="tracker-editor" key={tracker.id}>
      <div className="tracker-editor-head"><strong>{tracker.title}</strong><span>{Math.round(tracker.current / tracker.target * 100)}%</span><button onClick={() => { if (window.confirm(`Delete “${tracker.title}”?`)) setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.filter((entry) => entry.id !== tracker.id) }) })) }}>×</button></div>
      <div className="progress-values-editor"><label>Completed<input aria-label={`${tracker.title} completed`} type="number" min="0" max={tracker.target} value={tracker.current} onChange={(event) => setTrackerNumbers(tracker.id, Number(event.target.value), tracker.target)} /></label><span>/</span><label>Total<input aria-label={`${tracker.title} total`} type="number" min="1" value={tracker.target} onChange={(event) => setTrackerNumbers(tracker.id, tracker.current, Number(event.target.value))} /></label></div>
      <div className="tracker-next-editor"><label>Next visible action<input value={tracker.nextAction ?? ''} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.map((entry) => entry.id !== tracker.id ? entry : { ...entry, nextAction: event.target.value }) }) }))} placeholder="One concrete step" /></label><label>Minutes<input type="number" min="1" value={tracker.nextActionMinutes ?? ''} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.map((entry) => entry.id !== tracker.id ? entry : { ...entry, nextActionMinutes: Number(event.target.value) || undefined }) }) }))} /></label><label className="check-label"><input type="checkbox" checked={Boolean(tracker.isUncertain)} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.map((entry) => entry.id !== tracker.id ? entry : { ...entry, isUncertain: event.target.checked }) }) }))} /> More work may be undiscovered</label></div>
      {tracker.tasks.map((task) => <label className="task" key={task.id}><input type="checkbox" checked={task.completed} onChange={() => toggleTask(project.id, tracker.id, task.id)} /><span>{task.title}</span></label>)}
      <form className="tiny-form" onSubmit={(event) => { event.preventDefault(); addTask(project.id, tracker.id, taskInputs[tracker.id] ?? ''); setTaskInputs((current) => ({ ...current, [tracker.id]: '' })) }}><input value={taskInputs[tracker.id] ?? ''} onChange={(event) => setTaskInputs((current) => ({ ...current, [tracker.id]: event.target.value }))} placeholder="Optional named task" /><button>Add task</button></form>
    </div>)}
    <form className="tracker-form" onSubmit={(event) => { event.preventDefault(); addTracker(project.id, trackerTitle, Number(target)); setTrackerTitle(''); setTarget('1') }}><input value={trackerTitle} onChange={(event) => setTrackerTitle(event.target.value)} placeholder="Progress item" /><input aria-label="Target" type="number" min="1" value={target} onChange={(event) => setTarget(event.target.value)} /><button>Add</button></form>
    <button className="danger-button" onClick={() => { if (window.confirm(`Delete “${project.title}” and its progress items?`)) setData((current) => ({ ...current, projects: current.projects.filter((item) => item.id !== project.id) })) }}>Delete project</button>
  </section>
}

function ProjectEditorPrevious({ project, categories, addTracker, addTask, toggleTask, setData }: {
  project: Project
  categories: ProjectCategory[]
  addTracker: (projectId: string, title: string, target: number) => void
  addTask: (projectId: string, trackerId: string, title: string, estimateMinutes?: number, parentId?: string) => void
  toggleTask: (projectId: string, trackerId: string, taskId: string) => void
  setData: React.Dispatch<React.SetStateAction<AppData>>
}) {
  const [trackerTitle, setTrackerTitle] = useState('')
  const [target, setTarget] = useState('1')
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({})
  const [taskEstimates, setTaskEstimates] = useState<Record<string, string>>({})

  function updateTracker(trackerId: string, updater: (tasks: StockTask[]) => StockTask[]) {
    setData((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id !== project.id ? item : {
        ...item,
        trackers: item.trackers.map((tracker) => tracker.id !== trackerId ? tracker : { ...tracker, tasks: syncParentTasks(updater(tracker.tasks)) }),
      }),
    }))
  }

  function updateTask(trackerId: string, taskId: string, patch: Partial<StockTask>) {
    updateTracker(trackerId, (tasks) => tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task))
  }

  function deleteTask(trackerId: string, task: StockTask, tasks: StockTask[]) {
    const ids = descendantIds(tasks, task.id)
    if (ids.size > 1 && !window.confirm(`Delete “${task.title}” and its ${ids.size - 1} nested task${ids.size === 2 ? '' : 's'}?`)) return
    updateTracker(trackerId, (current) => current.filter((item) => !ids.has(item.id)))
  }

  function addWorklog(trackerId: string, taskId: string, minutes: number, date: string) {
    const safeMinutes = Math.max(1, Math.round(minutes))
    updateTracker(trackerId, (tasks) => tasks.map((task) => task.id === taskId ? {
      ...task,
      worklogs: [...task.worklogs, { id: id(), date, minutes: safeMinutes }],
      remainingEstimateMinutes: task.completed ? 0 : Math.max(0, task.remainingEstimateMinutes - safeMinutes),
    } : task))
  }

  function deleteWorklog(trackerId: string, taskId: string, worklogId: string) {
    updateTracker(trackerId, (tasks) => tasks.map((task) => task.id === taskId ? { ...task, worklogs: task.worklogs.filter((log) => log.id !== worklogId) } : task))
  }

  function setTrackerNumbers(trackerId: string, nextCurrent: number, nextTarget: number) {
    const safeTarget = Math.max(1, Number.isFinite(nextTarget) ? Math.round(nextTarget) : 1)
    const safeCurrent = Math.max(0, Math.min(safeTarget, Number.isFinite(nextCurrent) ? Math.round(nextCurrent) : 0))
    setData((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id !== project.id ? item : {
        ...item,
        trackers: item.trackers.map((entry) => entry.id !== trackerId ? entry : { ...entry, current: safeCurrent, target: safeTarget }),
      }),
    }))
  }

  return <section className="project-editor drawer-editor">
    <div className="project-meta-editor">
      <label>Project name<input value={project.title} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, title: event.target.value } : item) }))} /></label>
      <label>Category<select value={project.categoryId} onChange={(event) => { const category = categories.find((item) => item.id === event.target.value); setData((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, categoryId: event.target.value, color: category?.color ?? item.color } : item) })) }}>{categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}</select></label>
      <div className="project-percent-preview"><span>Project progress</span><strong>{projectPercent(project)}%</strong><small>Each progress item uses estimated-time weighting when it has tasks</small></div>
    </div>

    {project.trackers.map((tracker) => {
      const metrics = taskMetrics(tracker.tasks)
      const percent = trackerPercent(project, tracker.id)
      return <div className="tracker-editor" key={tracker.id}>
        <div className="tracker-editor-head"><strong>{tracker.title}</strong><span>{percent}%</span><button aria-label={`Delete ${tracker.title}`} onClick={() => { if (window.confirm(`Delete “${tracker.title}”?`)) setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.filter((entry) => entry.id !== tracker.id) }) })) }}>×</button></div>
        {tracker.tasks.length > 0 ? <div className="task-time-summary">
          <span><small>Estimated</small><strong>{formatMinutes(metrics.estimated)}</strong></span>
          <span><small>Spent</small><strong>{formatMinutes(metrics.spent)}</strong></span>
          <span><small>Remaining</small><strong>{formatMinutes(metrics.remaining)}</strong></span>
          <span><small>Leaf tasks</small><strong>{metrics.leafCount}</strong></span>
        </div> : <div className="progress-values-editor"><label>Completed<input aria-label={`${tracker.title} completed`} type="number" min="0" max={tracker.target} value={tracker.current} onChange={(event) => setTrackerNumbers(tracker.id, Number(event.target.value), tracker.target)} /></label><span>/</span><label>Total<input aria-label={`${tracker.title} total`} type="number" min="1" value={tracker.target} onChange={(event) => setTrackerNumbers(tracker.id, tracker.current, Number(event.target.value))} /></label></div>}
        <div className="tracker-next-editor"><label>Next visible action<input value={tracker.nextAction ?? ''} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.map((entry) => entry.id !== tracker.id ? entry : { ...entry, nextAction: event.target.value }) }) }))} placeholder="One concrete step" /></label><label>Minutes<input type="number" min="1" value={tracker.nextActionMinutes ?? ''} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.map((entry) => entry.id !== tracker.id ? entry : { ...entry, nextActionMinutes: Number(event.target.value) || undefined }) }) }))} /></label><label className="check-label"><input type="checkbox" checked={Boolean(tracker.isUncertain)} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.map((entry) => entry.id !== tracker.id ? entry : { ...entry, isUncertain: event.target.checked }) }) }))} /> More work may be undiscovered</label></div>

        {tracker.tasks.length > 0 && <div className="task-tree">{taskChildren(tracker.tasks).map((task) => <TaskNodePrevious
          key={task.id}
          task={task}
          tasks={tracker.tasks}
          depth={0}
          trackerId={tracker.id}
          projectId={project.id}
          addTask={addTask}
          toggleTask={toggleTask}
          updateTask={updateTask}
          deleteTask={deleteTask}
          addWorklog={addWorklog}
          deleteWorklog={deleteWorklog}
        />)}</div>}

        <form className="task-create-form" onSubmit={(event) => {
          event.preventDefault()
          addTask(project.id, tracker.id, taskInputs[tracker.id] ?? '', Number(taskEstimates[tracker.id] ?? 60))
          setTaskInputs((current) => ({ ...current, [tracker.id]: '' }))
          setTaskEstimates((current) => ({ ...current, [tracker.id]: '60' }))
        }}><input value={taskInputs[tracker.id] ?? ''} onChange={(event) => setTaskInputs((current) => ({ ...current, [tracker.id]: event.target.value }))} placeholder="New top-level task" /><label><span>Est. min</span><input aria-label={`${tracker.title} new task estimate minutes`} type="number" min="1" value={taskEstimates[tracker.id] ?? '60'} onChange={(event) => setTaskEstimates((current) => ({ ...current, [tracker.id]: event.target.value }))} /></label><button>Add task</button></form>
      </div>
    })}

    <form className="tracker-form" onSubmit={(event) => { event.preventDefault(); addTracker(project.id, trackerTitle, Number(target)); setTrackerTitle(''); setTarget('1') }}><input value={trackerTitle} onChange={(event) => setTrackerTitle(event.target.value)} placeholder="Progress item" /><input aria-label="Target" type="number" min="1" value={target} onChange={(event) => setTarget(event.target.value)} /><button>Add</button></form>
    <button className="danger-button" onClick={() => { if (window.confirm(`Delete “${project.title}” and its progress items?`)) setData((current) => ({ ...current, projects: current.projects.filter((item) => item.id !== project.id) })) }}>Delete project</button>
  </section>
}

function TaskNodePrevious({ task, tasks, depth, trackerId, projectId, addTask, toggleTask, updateTask, deleteTask, addWorklog, deleteWorklog }: {
  task: StockTask
  tasks: StockTask[]
  depth: number
  trackerId: string
  projectId: string
  addTask: (projectId: string, trackerId: string, title: string, estimateMinutes?: number, parentId?: string) => void
  toggleTask: (projectId: string, trackerId: string, taskId: string) => void
  updateTask: (trackerId: string, taskId: string, patch: Partial<StockTask>) => void
  deleteTask: (trackerId: string, task: StockTask, tasks: StockTask[]) => void
  addWorklog: (trackerId: string, taskId: string, minutes: number, date: string) => void
  deleteWorklog: (trackerId: string, taskId: string, worklogId: string) => void
}) {
  const children = taskChildren(tasks, task.id)
  const hasChildren = children.length > 0
  const metrics = taskMetrics(tasks, task.id)
  const [subtaskOpen, setSubtaskOpen] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskEstimate, setSubtaskEstimate] = useState(String(task.estimateMinutes || 60))
  const [timeOpen, setTimeOpen] = useState(false)
  const [logMinutes, setLogMinutes] = useState('30')
  const [logDate, setLogDate] = useState(localDate())

  return <div className={`task-node ${task.completed ? 'complete' : ''}`} style={{ marginLeft: depth > 0 ? '14px' : 0 }}>
    <div className="task-node-main">
      {hasChildren ? <button className="task-collapse" aria-label={`${task.collapsed ? 'Expand' : 'Collapse'} ${task.title}`} onClick={() => updateTask(trackerId, task.id, { collapsed: !task.collapsed })}>{task.collapsed ? '›' : '⌄'}</button> : <span className="task-leaf-dot" />}
      <input className="task-checkbox" aria-label={`Complete ${task.title}`} type="checkbox" checked={task.completed} disabled={hasChildren} onChange={() => toggleTask(projectId, trackerId, task.id)} />
      <input className="task-title-input" aria-label={`${task.title} title`} value={task.title} onChange={(event) => updateTask(trackerId, task.id, { title: event.target.value })} />
      <span className="task-percent">{metrics.percent}%</span>
      <button className="task-action" onClick={() => setSubtaskOpen((value) => !value)}>+ Subtask</button>
      <button className="task-action" onClick={() => setTimeOpen((value) => !value)}>Time</button>
      <button className="task-delete" aria-label={`Delete ${task.title}`} onClick={() => deleteTask(trackerId, task, tasks)}>×</button>
    </div>

    <div className="task-node-metrics">
      {hasChildren ? <><span>Estimated <b>{formatMinutes(metrics.estimated)}</b></span><span>Spent <b>{formatMinutes(metrics.spent)}</b></span><span>Remaining <b>{formatMinutes(metrics.remaining)}</b></span></> : <>
        <label>Estimate <input aria-label={`${task.title} estimate minutes`} type="number" min="1" value={task.estimateMinutes} onChange={(event) => { const estimateMinutes = Math.max(1, Number(event.target.value) || 1); updateTask(trackerId, task.id, { estimateMinutes, remainingEstimateMinutes: task.remainingEstimateMinutes === task.estimateMinutes ? estimateMinutes : task.remainingEstimateMinutes }) }} /> min</label>
        <span>Spent <b>{formatMinutes(metrics.spent)}</b></span>
        <label>Remaining <input aria-label={`${task.title} remaining minutes`} type="number" min="0" value={task.remainingEstimateMinutes} disabled={task.completed} onChange={(event) => updateTask(trackerId, task.id, { remainingEstimateMinutes: Math.max(0, Number(event.target.value) || 0) })} /> min</label>
      </>}
    </div>

    {subtaskOpen && <form className="subtask-form" onSubmit={(event) => { event.preventDefault(); addTask(projectId, trackerId, subtaskTitle, Number(subtaskEstimate), task.id); setSubtaskTitle(''); setSubtaskOpen(false) }}><input autoFocus value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Nested task" /><input aria-label="Subtask estimate minutes" type="number" min="1" value={subtaskEstimate} onChange={(event) => setSubtaskEstimate(event.target.value)} /><button>Add</button></form>}

    {timeOpen && <div className="worklog-panel">
      <form onSubmit={(event) => { event.preventDefault(); addWorklog(trackerId, task.id, Number(logMinutes), logDate); setLogMinutes('30') }}><input aria-label="Actual minutes" type="number" min="1" value={logMinutes} onChange={(event) => setLogMinutes(event.target.value)} /><input aria-label="Work date" type="date" value={logDate} onChange={(event) => setLogDate(event.target.value)} /><button>Log time</button></form>
      {task.worklogs.length > 0 && <div className="worklog-list">{task.worklogs.map((log) => <div key={log.id}><span>{log.date}</span><strong>{formatMinutes(log.minutes)}</strong><button aria-label={`Delete ${formatMinutes(log.minutes)} worklog`} onClick={() => deleteWorklog(trackerId, task.id, log.id)}>×</button></div>)}</div>}
    </div>}

    {hasChildren && !task.collapsed && <div className="task-children">{children.map((child) => <TaskNodePrevious key={child.id} task={child} tasks={tasks} depth={depth + 1} trackerId={trackerId} projectId={projectId} addTask={addTask} toggleTask={toggleTask} updateTask={updateTask} deleteTask={deleteTask} addWorklog={addWorklog} deleteWorklog={deleteWorklog} />)}</div>}
  </div>
}

function ProjectEditor({ project, categories, addTracker, addTask, toggleTask, setData }: {
  project: Project
  categories: ProjectCategory[]
  addTracker: (projectId: string, title: string, target: number) => void
  addTask: (projectId: string, trackerId: string, title: string, estimateMinutes?: number, parentId?: string) => void
  toggleTask: (projectId: string, trackerId: string, taskId: string) => void
  setData: React.Dispatch<React.SetStateAction<AppData>>
}) {
  const [groupTitle, setGroupTitle] = useState('')
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({})
  const [taskEstimates, setTaskEstimates] = useState<Record<string, string>>({})
  const [supportTitle, setSupportTitle] = useState('')
  const [supportType, setSupportType] = useState<SupportWorkType>('Learning')
  const [supportEstimate, setSupportEstimate] = useState('')
  const [draggedTask, setDraggedTask] = useState<{ trackerId: string; taskId: string; parentId?: string }>()
  const draggedTaskRef = useRef<{ trackerId: string; taskId: string; parentId?: string }>()
  const [taskDropTarget, setTaskDropTarget] = useState<{ trackerId: string; taskId: string; position: 'before' | 'after' }>()
  const metrics = projectMetrics(project)

  function updateProject(patch: Partial<Project>) {
    setData((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, ...patch } : item) }))
  }

  function updateTracker(trackerId: string, updater: (tasks: StockTask[]) => StockTask[]) {
    setData((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id !== project.id ? item : {
        ...item,
        trackers: item.trackers.map((tracker) => tracker.id !== trackerId ? tracker : { ...tracker, tasks: syncParentTasks(updater(tracker.tasks)) }),
      }),
    }))
  }

  function updateTask(trackerId: string, taskId: string, patch: Partial<StockTask>) {
    updateTracker(trackerId, (tasks) => tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task))
  }

  function deleteTask(trackerId: string, task: StockTask, tasks: StockTask[]) {
    const ids = descendantIds(tasks, task.id)
    if (!window.confirm(ids.size > 1
      ? `Delete “${task.title}” and its ${ids.size - 1} nested task${ids.size === 2 ? '' : 's'}?`
      : `Delete “${task.title}”?`)) return
    updateTracker(trackerId, (current) => current.filter((item) => !ids.has(item.id)))
  }

  function startTaskDrag(event: React.DragEvent<HTMLElement>, trackerId: string, task: StockTask) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
    const active = { trackerId, taskId: task.id, parentId: task.parentId }
    draggedTaskRef.current = active
    setDraggedTask(active)
  }

  function clearTaskDrag() {
    draggedTaskRef.current = undefined
    setDraggedTask(undefined)
    setTaskDropTarget(undefined)
  }

  function dragOverTask(event: React.DragEvent<HTMLDivElement>, trackerId: string, task: StockTask) {
    const active = draggedTaskRef.current ?? draggedTask
    if (!active || active.trackerId !== trackerId || active.taskId === task.id || (active.parentId ?? '') !== (task.parentId ?? '')) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    setTaskDropTarget({ trackerId, taskId: task.id, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' })
  }

  function dropTask(event: React.DragEvent<HTMLDivElement>, trackerId: string, targetTask: StockTask) {
    const active = draggedTaskRef.current ?? draggedTask
    event.preventDefault()
    event.stopPropagation()
    if (!active || active.trackerId !== trackerId || active.taskId === targetTask.id || (active.parentId ?? '') !== (targetTask.parentId ?? '')) {
      clearTaskDrag()
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    updateTracker(trackerId, (tasks) => {
      const moving = tasks.find((task) => task.id === active.taskId)
      if (!moving) return tasks
      const siblings = tasks.filter((task) => (task.parentId ?? '') === (moving.parentId ?? '') && task.id !== moving.id)
      const targetIndex = siblings.findIndex((task) => task.id === targetTask.id)
      if (targetIndex < 0) return tasks
      siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moving)
      let siblingIndex = 0
      return tasks.map((task) => (task.parentId ?? '') === (moving.parentId ?? '') ? siblings[siblingIndex++] : task)
    })
    clearTaskDrag()
  }

  function addTaskWorklog(trackerId: string, taskId: string, minutes: number, date: string, note: string) {
    updateTracker(trackerId, (tasks) => tasks.map((task) => {
      if (task.id !== taskId) return task
      const safeMinutes = Math.max(1, Math.round(minutes))
      const isLeaf = !tasks.some((child) => child.parentId === taskId)
      if (isLeaf && loggedMinutes(task) + safeMinutes > task.estimateMinutes) return task
      const worklogs = [...task.worklogs, { id: id(), date, minutes: safeMinutes, note: note.trim() || undefined }]
      return { ...task, worklogs, remainingEstimateMinutes: task.completed ? 0 : Math.max(0, task.estimateMinutes - worklogs.reduce((sum, log) => sum + log.minutes, 0)) }
    }))
  }

  function updateTaskWorklog(trackerId: string, taskId: string, worklogId: string, patch: Partial<TaskWorklog>) {
    updateTracker(trackerId, (tasks) => tasks.map((task) => {
      if (task.id !== taskId) return task
      const worklogs = task.worklogs.map((log) => log.id === worklogId ? { ...log, ...patch } : log)
      const isLeaf = !tasks.some((child) => child.parentId === taskId)
      if (isLeaf && worklogs.reduce((sum, log) => sum + log.minutes, 0) > task.estimateMinutes) return task
      return { ...task, worklogs, remainingEstimateMinutes: task.completed ? 0 : Math.max(0, task.estimateMinutes - worklogs.reduce((sum, log) => sum + log.minutes, 0)) }
    }))
  }

  function deleteTaskWorklog(trackerId: string, taskId: string, worklogId: string) {
    updateTracker(trackerId, (tasks) => tasks.map((task) => {
      if (task.id !== taskId) return task
      const worklogs = task.worklogs.filter((log) => log.id !== worklogId)
      return { ...task, worklogs, remainingEstimateMinutes: task.completed ? 0 : Math.max(0, task.estimateMinutes - worklogs.reduce((sum, log) => sum + log.minutes, 0)) }
    }))
  }

  function addSupportWork(event: FormEvent) {
    event.preventDefault()
    if (!supportTitle.trim()) return
    const item: SupportWorkItem = {
      id: id(),
      title: supportTitle.trim(),
      description: '',
      type: supportType,
      completed: false,
      estimateMinutes: supportEstimate ? Math.max(1, Number(supportEstimate)) : undefined,
      worklogs: [],
    }
    updateProject({ supportWork: [...project.supportWork, item] })
    setSupportTitle('')
    setSupportEstimate('')
  }

  function updateSupportWork(itemId: string, patch: Partial<SupportWorkItem>) {
    updateProject({ supportWork: project.supportWork.map((item) => item.id === itemId ? { ...item, ...patch } : item) })
  }

  function deleteSupportWork(item: SupportWorkItem) {
    if (!window.confirm(`Delete “${item.title}” and its time records?`)) return
    updateProject({ supportWork: project.supportWork.filter((entry) => entry.id !== item.id) })
  }

  return <section className="project-editor drawer-editor redesigned-project-editor">
    <div className="project-meta-editor">
      <label>Project name<input value={project.title} onChange={(event) => updateProject({ title: event.target.value })} /></label>
      <label>Category<select value={project.categoryId} onChange={(event) => { const category = categories.find((item) => item.id === event.target.value); updateProject({ categoryId: event.target.value, color: category?.color ?? project.color }) }}>{categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}</select></label>
      <label className="project-description-field">Project description<textarea rows={3} value={project.description ?? ''} onChange={(event) => updateProject({ description: event.target.value })} placeholder="What does finished look like? Add context, links, or constraints." /></label>
    </div>

    <div className="project-metric-grid">
      <div className="primary-metric"><span>Delivery progress</span><strong>{metrics.percent}%</strong><small>Completed estimated weight</small></div>
      <div><span>Total invested</span><strong>{formatMinutes(metrics.totalSpent)}</strong><small>Direct + supporting work</small></div>
      <div><span>Delivery remaining</span><strong>{formatMinutes(metrics.remaining)}</strong><small>Estimate minus logged actual time</small></div>
      <div><span>Supporting work</span><strong>{formatMinutes(metrics.supportSpent)}</strong><small>Does not change progress</small></div>
    </div>
    <div className="project-progress-overview"><div><span style={{ width: `${metrics.percent}%`, background: project.color }} /></div><p><strong>{formatMinutes(metrics.estimated)}</strong> delivery estimate · <strong>{metrics.leafCount}</strong> leaf task{metrics.leafCount === 1 ? '' : 's'}</p></div>

    <section className="project-editor-section">
      <div className="project-section-heading"><div><p className="eyebrow">Direct deliverables</p><h3>Work that changes project progress</h3></div><span>Actual time never changes the percentage.</span></div>
      {project.trackers.map((tracker) => {
        const trackerMetrics = taskMetrics(tracker.tasks)
        return <article className="tracker-editor deliverable-group" key={tracker.id}>
          <div className="tracker-editor-head">
            <input aria-label="Deliverable group name" value={tracker.title} onChange={(event) => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id !== project.id ? item : { ...item, trackers: item.trackers.map((entry) => entry.id === tracker.id ? { ...entry, title: event.target.value } : entry) }) }))} />
            <span>{trackerPercent(project, tracker.id)}%</span>
            <button aria-label={`Delete ${tracker.title}`} disabled={project.trackers.length === 1} onClick={() => { if (window.confirm(`Delete “${tracker.title}” and all its tasks?`)) updateProject({ trackers: project.trackers.filter((entry) => entry.id !== tracker.id) }) }}>×</button>
          </div>
          <div className="task-time-summary">
            <span><small>Estimated</small><strong>{formatMinutes(trackerMetrics.estimated)}</strong></span>
            <span><small>Remaining</small><strong>{formatMinutes(trackerMetrics.remaining)}</strong></span>
            <span><small>Actual</small><strong>{formatMinutes(trackerMetrics.spent)}</strong></span>
            <span><small>Project weight</small><strong>{metrics.estimated ? Math.round(trackerMetrics.estimated / metrics.estimated * 100) : 0}%</strong></span>
          </div>

          {tracker.tasks.length === 0 ? <p className="project-section-empty">Add the first deliverable task. Its estimate becomes its weight in this project.</p> : <div className="task-tree">{taskChildren(tracker.tasks).map((task) => <TaskNode
            key={task.id}
            task={task}
            tasks={tracker.tasks}
            depth={0}
            trackerId={tracker.id}
            projectId={project.id}
            projectEstimate={metrics.estimated}
            addTask={addTask}
            toggleTask={toggleTask}
            updateTask={updateTask}
            deleteTask={deleteTask}
            addWorklog={addTaskWorklog}
            updateWorklog={updateTaskWorklog}
            deleteWorklog={deleteTaskWorklog}
            draggedTask={draggedTask}
            taskDropTarget={taskDropTarget}
            startTaskDrag={startTaskDrag}
            clearTaskDrag={clearTaskDrag}
            dragOverTask={dragOverTask}
            dropTask={dropTask}
          />)}</div>}

          <form className="task-create-form" onSubmit={(event) => {
            event.preventDefault()
            addTask(project.id, tracker.id, taskInputs[tracker.id] ?? '', Number(taskEstimates[tracker.id] ?? 60))
            setTaskInputs((current) => ({ ...current, [tracker.id]: '' }))
            setTaskEstimates((current) => ({ ...current, [tracker.id]: '60' }))
          }}><input value={taskInputs[tracker.id] ?? ''} onChange={(event) => setTaskInputs((current) => ({ ...current, [tracker.id]: event.target.value }))} placeholder="New direct task" /><label><span>Estimate (min)</span><input aria-label={`${tracker.title} new task estimate minutes`} type="number" min="1" value={taskEstimates[tracker.id] ?? '60'} onChange={(event) => setTaskEstimates((current) => ({ ...current, [tracker.id]: event.target.value }))} /></label><button>Add task</button></form>
        </article>
      })}
      <form className="deliverable-group-form" onSubmit={(event) => { event.preventDefault(); addTracker(project.id, groupTitle, 1); setGroupTitle('') }}><input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Optional new deliverable group" /><button>Add group</button></form>
    </section>

    <section className="project-editor-section support-work-section">
      <div className="project-section-heading"><div><p className="eyebrow">Supporting work</p><h3>Time that counts, without inflating progress</h3></div><span>Learning, research, troubleshooting, planning and exploration.</span></div>
      <form className="support-create-form" onSubmit={addSupportWork}>
        <input value={supportTitle} onChange={(event) => setSupportTitle(event.target.value)} placeholder="What supporting work are you doing?" />
        <select value={supportType} onChange={(event) => setSupportType(event.target.value as SupportWorkType)}>{SUPPORT_WORK_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        <input aria-label="Optional supporting work estimate in minutes" type="number" min="1" value={supportEstimate} onChange={(event) => setSupportEstimate(event.target.value)} placeholder="Est. min" />
        <button>Add</button>
      </form>
      {project.supportWork.length === 0 ? <p className="project-section-empty">No supporting work yet. Add learning or investigation here when it belongs to the project but not to delivery progress.</p> : <div className="support-work-list">{project.supportWork.map((item) => <SupportWorkCard key={item.id} item={item} onChange={(patch) => updateSupportWork(item.id, patch)} onDelete={() => deleteSupportWork(item)} />)}</div>}
    </section>

    <button className="danger-button" onClick={() => { if (window.confirm(`Delete “${project.title}” and all its records?`)) setData((current) => ({ ...current, projects: current.projects.filter((item) => item.id !== project.id) })) }}>Delete project</button>
  </section>
}

function DeferredNumberInput({ value, min = 0, ariaLabel, onCommit }: {
  value: number
  min?: number
  ariaLabel: string
  onCommit: (value: number) => boolean | void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  function commit() {
    if (draft.trim() === '') {
      setDraft(String(value))
      return
    }
    const parsed = Math.max(min, Math.round(Number(draft)))
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const accepted = onCommit(parsed)
    setDraft(String(accepted === false ? value : parsed))
  }

  return <input
    aria-label={ariaLabel}
    type="number"
    min={min}
    value={draft}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
  />
}

function TaskNode({ task, tasks, depth, trackerId, projectId, projectEstimate, addTask, toggleTask, updateTask, deleteTask, addWorklog, updateWorklog, deleteWorklog, draggedTask, taskDropTarget, startTaskDrag, clearTaskDrag, dragOverTask, dropTask }: {
  task: StockTask
  tasks: StockTask[]
  depth: number
  trackerId: string
  projectId: string
  projectEstimate: number
  addTask: (projectId: string, trackerId: string, title: string, estimateMinutes?: number, parentId?: string) => void
  toggleTask: (projectId: string, trackerId: string, taskId: string) => void
  updateTask: (trackerId: string, taskId: string, patch: Partial<StockTask>) => void
  deleteTask: (trackerId: string, task: StockTask, tasks: StockTask[]) => void
  addWorklog: (trackerId: string, taskId: string, minutes: number, date: string, note: string) => void
  updateWorklog: (trackerId: string, taskId: string, worklogId: string, patch: Partial<TaskWorklog>) => void
  deleteWorklog: (trackerId: string, taskId: string, worklogId: string) => void
  draggedTask?: { trackerId: string; taskId: string; parentId?: string }
  taskDropTarget?: { trackerId: string; taskId: string; position: 'before' | 'after' }
  startTaskDrag: (event: React.DragEvent<HTMLElement>, trackerId: string, task: StockTask) => void
  clearTaskDrag: () => void
  dragOverTask: (event: React.DragEvent<HTMLDivElement>, trackerId: string, task: StockTask) => void
  dropTask: (event: React.DragEvent<HTMLDivElement>, trackerId: string, task: StockTask) => void
}) {
  const children = taskChildren(tasks, task.id)
  const hasChildren = children.length > 0
  const metrics = taskMetrics(tasks, task.id)
  const weight = projectEstimate ? Math.round(metrics.estimated / projectEstimate * 100) : 0
  const [subtaskOpen, setSubtaskOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskEstimate, setSubtaskEstimate] = useState(String(task.estimateMinutes || 60))
  const [quickActual, setQuickActual] = useState('')
  const [timeError, setTimeError] = useState('')
  const actualMinutes = loggedMinutes(task)
  const availableMinutes = Math.max(0, task.estimateMinutes - actualMinutes)
  const effortPercent = task.estimateMinutes ? Math.min(100, Math.round(actualMinutes / task.estimateMinutes * 100)) : 0

  function updateEstimate(estimateMinutes: number) {
    if (estimateMinutes < actualMinutes) {
      setTimeError(`Estimate cannot be lower than the ${formatMinutes(actualMinutes)} already logged.`)
      return false
    }
    setTimeError('')
    updateTask(trackerId, task.id, {
      estimateMinutes,
      remainingEstimateMinutes: task.completed ? 0 : estimateMinutes - actualMinutes,
    })
    return true
  }

  function logActual(event: FormEvent) {
    event.preventDefault()
    const minutes = Math.round(Number(quickActual))
    if (!Number.isFinite(minutes) || minutes < 1) return
    if (minutes > availableMinutes) {
      setTimeError(`Only ${formatMinutes(availableMinutes)} remains. Increase the estimate before logging more time.`)
      return
    }
    addWorklog(trackerId, task.id, minutes, localDate(), '')
    setTimeError('')
    setQuickActual('')
  }

  const dropClass = taskDropTarget?.trackerId === trackerId && taskDropTarget.taskId === task.id ? ` task-drop-${taskDropTarget.position}` : ''
  const draggingClass = draggedTask?.trackerId === trackerId && draggedTask.taskId === task.id ? ' dragging' : ''

  return <div className={`task-node ${task.completed ? 'complete' : ''}${draggingClass}${dropClass}`} style={{ marginLeft: depth > 0 ? '14px' : 0 }} onDragOver={(event) => dragOverTask(event, trackerId, task)} onDrop={(event) => dropTask(event, trackerId, task)}>
    <div className="task-node-main redesigned-task-main">
      <span className="drag-handle task-drag-handle" draggable role="button" tabIndex={0} aria-label={`Drag to reorder ${task.title}`} title="Drag within this level" onDragStart={(event) => startTaskDrag(event, trackerId, task)} onDragEnd={clearTaskDrag}><span className="drag-grip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span></span>
      {hasChildren ? <button className="task-collapse" aria-label={`${task.collapsed ? 'Expand' : 'Collapse'} ${task.title}`} onClick={() => updateTask(trackerId, task.id, { collapsed: !task.collapsed })}>{task.collapsed ? '›' : '⌄'}</button> : <span className="task-leaf-dot" />}
      <input className="task-checkbox" aria-label={`Complete ${task.title}`} type="checkbox" checked={task.completed} disabled={hasChildren} onChange={() => toggleTask(projectId, trackerId, task.id)} />
      <input className="task-title-input" aria-label={`${task.title} title`} value={task.title} onChange={(event) => updateTask(trackerId, task.id, { title: event.target.value })} />
      <span className="task-percent">{weight}% weight</span>
      <button className="task-action" onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? 'Hide' : 'Details'}</button>
      <button className="task-action" onClick={() => setSubtaskOpen((value) => !value)}>+ Subtask</button>
      <button className="task-delete" aria-label={`Delete ${task.title}`} onClick={() => deleteTask(trackerId, task, tasks)}>×</button>
    </div>

    <div className="task-node-metrics">
      {hasChildren ? <><span>Estimated <b>{formatMinutes(metrics.estimated)}</b></span><span>Remaining <b>{formatMinutes(metrics.remaining)}</b></span><span>Actual <b>{formatMinutes(metrics.spent)}</b></span><span>Progress <b>{metrics.percent}%</b></span></> : <>
        <label>Estimate <DeferredNumberInput ariaLabel={`${task.title} estimate minutes`} min={1} value={task.estimateMinutes} onCommit={updateEstimate} /> min</label>
        <span>Remaining <b>{formatMinutes(metrics.remaining)}</b></span>
        <span>Actual <b>{formatMinutes(metrics.spent)}</b></span>
        <form className="quick-actual-form" onSubmit={logActual}><label>Log actual <input aria-label={`${task.title} new actual minutes`} type="number" min="1" value={quickActual} disabled={availableMinutes === 0} onChange={(event) => { setQuickActual(event.target.value); setTimeError('') }} placeholder={availableMinutes === 0 ? 'Full' : `${availableMinutes} left`} /></label><button disabled={availableMinutes === 0}>Add</button></form>
      </>}
    </div>

    {!hasChildren && <div className="task-effort">
      <div className="task-effort-heading"><span>Time invested</span><strong>{effortPercent}%</strong></div>
      <div className="task-effort-track" role="progressbar" aria-label={`${task.title} time invested`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={effortPercent}><span style={{ width: `${effortPercent}%` }} /></div>
      <p>{task.completed ? `Completed in ${formatMinutes(actualMinutes)} · estimated ${formatMinutes(task.estimateMinutes)}` : `${formatMinutes(actualMinutes)} of ${formatMinutes(task.estimateMinutes)} recorded`}</p>
    </div>}
    {timeError && <p className="task-time-error" role="alert">{timeError}</p>}

    {detailsOpen && <div className="task-details-panel">
      <label>Description<textarea rows={3} value={task.description ?? ''} onChange={(event) => updateTask(trackerId, task.id, { description: event.target.value })} placeholder="Requirements, context, links, or notes for this task." /></label>
      <EditableWorklogs
        logs={task.worklogs}
        maxMinutes={hasChildren ? undefined : task.estimateMinutes}
        onAdd={(minutes, date, note) => addWorklog(trackerId, task.id, minutes, date, note)}
        onUpdate={(worklogId, patch) => updateWorklog(trackerId, task.id, worklogId, patch)}
        onDelete={(worklogId) => deleteWorklog(trackerId, task.id, worklogId)}
      />
    </div>}

    {subtaskOpen && <form className="subtask-form" onSubmit={(event) => { event.preventDefault(); addTask(projectId, trackerId, subtaskTitle, Number(subtaskEstimate), task.id); setSubtaskTitle(''); setSubtaskOpen(false) }}><input autoFocus value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Nested task" /><input aria-label="Subtask estimate minutes" type="number" min="1" value={subtaskEstimate} onChange={(event) => setSubtaskEstimate(event.target.value)} /><button>Add</button></form>}

    {hasChildren && !task.collapsed && <div className="task-children">{children.map((child) => <TaskNode key={child.id} task={child} tasks={tasks} depth={depth + 1} trackerId={trackerId} projectId={projectId} projectEstimate={projectEstimate} addTask={addTask} toggleTask={toggleTask} updateTask={updateTask} deleteTask={deleteTask} addWorklog={addWorklog} updateWorklog={updateWorklog} deleteWorklog={deleteWorklog} draggedTask={draggedTask} taskDropTarget={taskDropTarget} startTaskDrag={startTaskDrag} clearTaskDrag={clearTaskDrag} dragOverTask={dragOverTask} dropTask={dropTask} />)}</div>}
  </div>
}

function EditableWorklogs({ logs, maxMinutes, onAdd, onUpdate, onDelete }: {
  logs: TaskWorklog[]
  maxMinutes?: number
  onAdd: (minutes: number, date: string, note: string) => void
  onUpdate: (worklogId: string, patch: Partial<TaskWorklog>) => void
  onDelete: (worklogId: string) => void
}) {
  const [minutes, setMinutes] = useState('30')
  const [date, setDate] = useState(localDate())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const spent = logs.reduce((sum, log) => sum + log.minutes, 0)
  const available = maxMinutes === undefined ? undefined : Math.max(0, maxMinutes - spent)

  function addLog(event: FormEvent) {
    event.preventDefault()
    const nextMinutes = Math.max(1, Math.round(Number(minutes)) || 1)
    if (available !== undefined && nextMinutes > available) {
      setError(`Only ${formatMinutes(available)} remains. Increase the estimate before logging more time.`)
      return
    }
    onAdd(nextMinutes, date, note)
    setError('')
    setMinutes('30')
    setNote('')
  }

  function updateMinutes(log: TaskWorklog, nextMinutes: number) {
    if (maxMinutes !== undefined && spent - log.minutes + nextMinutes > maxMinutes) {
      const maximum = Math.max(1, maxMinutes - (spent - log.minutes))
      setError(`This record can be at most ${formatMinutes(maximum)} unless you increase the estimate.`)
      return false
    }
    setError('')
    onUpdate(log.id, { minutes: nextMinutes })
    return true
  }

  return <div className="editable-worklogs">
    <div className="worklog-title"><strong>Actual time</strong><span>{formatMinutes(spent)} logged{available === undefined ? '' : ` · ${formatMinutes(available)} available`}</span></div>
    <form onSubmit={addLog}>
      <input aria-label="Actual minutes" type="number" min="1" value={minutes} disabled={available === 0} onChange={(event) => { setMinutes(event.target.value); setError('') }} />
      <input aria-label="Work date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      <input aria-label="Time record note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did this time go toward?" />
      <button disabled={available === 0}>Log time</button>
    </form>
    {error && <p className="task-time-error" role="alert">{error}</p>}
    {logs.length > 0 && <div className="editable-worklog-list">{logs.map((log) => <div key={log.id}>
      <input aria-label="Recorded date" type="date" value={log.date} onChange={(event) => onUpdate(log.id, { date: event.target.value })} />
      <input aria-label="Time record note" value={log.note ?? ''} onChange={(event) => onUpdate(log.id, { note: event.target.value })} placeholder="No note" />
      <label><DeferredNumberInput ariaLabel="Recorded minutes" min={1} value={log.minutes} onCommit={(minutes) => updateMinutes(log, minutes)} /> min</label>
      <button aria-label={`Delete ${formatMinutes(log.minutes)} time record`} onClick={() => onDelete(log.id)}>×</button>
    </div>)}</div>}
  </div>
}

function SupportWorkCard({ item, onChange, onDelete }: { item: SupportWorkItem; onChange: (patch: Partial<SupportWorkItem>) => void; onDelete: () => void }) {
  const spent = item.worklogs.reduce((sum, log) => sum + log.minutes, 0)
  return <article className={`support-work-card ${item.completed ? 'complete' : ''}`}>
    <div className="support-work-head">
      <input type="checkbox" checked={item.completed} aria-label={`Complete ${item.title}`} onChange={(event) => onChange({ completed: event.target.checked, completedAt: event.target.checked ? localDate() : undefined })} />
      <input className="support-title-input" value={item.title} onChange={(event) => onChange({ title: event.target.value })} aria-label="Supporting work title" />
      <select value={item.type} onChange={(event) => onChange({ type: event.target.value as SupportWorkType })}>{SUPPORT_WORK_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
      <button aria-label={`Delete ${item.title}`} onClick={onDelete}>×</button>
    </div>
    <textarea rows={2} value={item.description ?? ''} onChange={(event) => onChange({ description: event.target.value })} placeholder="Description, learning goal, investigation question, or outcome." />
    <div className="support-work-metrics">
      <label>Optional estimate <input type="number" min="1" value={item.estimateMinutes ?? ''} onChange={(event) => onChange({ estimateMinutes: event.target.value ? Math.max(1, Number(event.target.value)) : undefined })} /> min</label>
      <span>Actual <strong>{formatMinutes(spent)}</strong></span>
      <span className="no-progress-pill">Does not affect progress</span>
    </div>
    <EditableWorklogs
      logs={item.worklogs}
      onAdd={(minutes, date, note) => onChange({ worklogs: [...item.worklogs, { id: id(), minutes, date, note: note.trim() || undefined }] })}
      onUpdate={(worklogId, patch) => onChange({ worklogs: item.worklogs.map((log) => log.id === worklogId ? { ...log, ...patch } : log) })}
      onDelete={(worklogId) => onChange({ worklogs: item.worklogs.filter((log) => log.id !== worklogId) })}
    />
  </article>
}
