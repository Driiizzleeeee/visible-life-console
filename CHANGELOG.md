# Changelog / 更新日志

[English](#english) | [中文](#中文)

## English

Visible Life Console is developed iteratively from real daily use. This log highlights meaningful additions, changes, and fixes without listing every small implementation detail.

### 2026-10-18

#### Added

- Created the first working version of Visible Life Console.
- Added the project progress dashboard, monthly calendar, routines, activity map, focus workflow, flexible boards, and mottos.
- Added browser-local storage with JSON and CSV export.

### 2026-10-20

#### Added

- Added drag-and-drop ordering for Daily Tasks, Weekly Targets, and Daily Essentials.

#### Changed

- Improved motto presentation with line breaks, lightweight Markdown bold text, adaptive sizing, and centred content.
- Reworked the README into an English-first bilingual project document.

### 2026-10-22

#### Added

- Developed the Life module on the `feature/life-module` branch.
- Added Life This Month, Someday Dreams, and Life Moments.
- Added selectable colours for calendar events.

### 2026-10-23

#### Added

- Added cumulative actual-time logging for deliverable tasks.
- Added a project changelog for a clearer public development history.

#### Changed

- Remaining time is now calculated automatically from the estimate minus logged actual time.
- Deliverable metrics now appear as Estimate, Remaining, and Actual.
- Numeric time inputs can be cleared before a new value is entered.

#### Fixed

- Fixed remaining-time updates when estimates or worklogs change.
- Added compatibility for data previously written as version 11 while keeping the current data format at version 10.
- Prevented the recent data-version mismatch from recurring on the main branch.

### 2026-10-24

#### Added

- Added an automatic Time Invested bar to each leaf deliverable task so recorded effort stays visible before completion.
- Added drag-handle ordering for projects within and across categories, and constrained sibling ordering for parent and child deliverable tasks.

#### Changed

- Actual time for a leaf task can no longer exceed its estimate.
- An estimate can no longer be reduced below the actual time already recorded.
- Quick logging and detailed worklog editing now show the available time and explain when the estimate must be increased.

### 2026-10-27

#### Added

- Linked Life This Month invitations to the monthly calendar with a distinct heart marker and scheduling from either view.
- Added reversible completion checkboxes for Someday Dreams while preserving recorded Life Moments.
- Split the Life area into This Month, Moments, Someday Dreams, and a standalone Life Archive.

#### Changed

- Life now opens directly to the Life Archive, while Moment creation remains in its own view.
- Clarified the difference between ordinary calendar events and Life invitations without turning calendar plans into completion tasks.

## 中文

Visible Life Console 会根据真实的日常使用体验持续迭代。本日志只记录有意义的新增功能、调整和修复，不罗列每一项细小的实现改动。

### 2026-10-18

#### 新增

- 完成 Visible Life Console 的第一个可运行版本。
- 新增项目进度面板、月历、重复任务、活动方块图、专注流程、灵活事项板和每日标语。
- 新增浏览器本地存储，以及 JSON 和 CSV 导出功能。

### 2026-10-20

#### 新增

- 每日任务、每周目标和 Daily Essentials 现在支持拖动排序。

#### 调整

- 改进标语展示，支持换行、简单的 Markdown 加粗、自适应字号和居中显示。
- 将 README 调整为英文优先的中英双语项目文档。

### 2026-10-22

#### 新增

- 在 `feature/life-module` 功能分支中开发 Life 模块。
- 新增 Life This Month、Someday Dreams 和 Life Moments。
- 新增日历事项颜色选择功能。

### 2026-10-23

#### 新增

- 为交付任务新增累计实际投入时间记录。
- 新增项目更新日志，更清楚地展示公开开发过程。

#### 调整

- 剩余时间现在根据预计时间减去累计实际投入时间自动计算。
- 交付任务指标的显示顺序调整为预计时间、剩余时间、实际时间。
- 时间数字输入框现在可以先完全清空，再输入新的数值。

#### 修复

- 修复修改预计时间或时间记录后，剩余时间更新不正确的问题。
- 在继续使用数据版本 10 的同时，兼容读取之前写入的版本 11 数据。
- 防止主分支再次因为数据版本不匹配而清空本地数据。

### 2026-10-24

#### 新增

- 为每个最底层交付任务新增自动计算的 Time Invested 努力条，让任务完成前已经投入的时间也保持可见。
- 为项目新增大类内部及跨大类拖动排序，并为父任务和子任务新增受层级约束的同级拖动排序。

#### 调整

- 最底层任务的实际投入时间不能再超过预计时间。
- 预计时间不能再调低到小于已经记录的实际投入时间。
- 快速记录和详细时间记录现在会显示可用时间，并在需要增加预计时间时给出明确提示。

### 2026-10-27

#### 新增

- 将 Life This Month 邀请与月历关联，并使用独立的心形标记；现在可以从日历或 Life 页面安排日期。
- 为 Someday Dreams 新增可取消的完成勾选，同时保留已经记录的 Life Moments。
- 将 Life 区域拆分为 This Month、Moments、Someday Dreams 和独立的 Life Archive。

#### 调整

- 打开 Life 时现在默认显示 Life Archive，Moment 新增功能则保留在单独页面中。
- 更清楚地区分普通日历事件与 Life 邀请，同时不把日历安排变成需要完成的打卡任务。
