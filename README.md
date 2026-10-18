# Visible Life Console｜可视化个人生活控制台

## 中文

Visible Life Console 是一个本地优先的“外置工作记忆”工具。它的目标不是让生活变得更忙，而是让长期进度、已经完成的成果和下一步行动保持可见。

### 第一次使用

双击 `start-visible-life-console.cmd`。浏览器会打开 `http://127.0.0.1:4173`。使用期间请保留命令窗口，关闭窗口即可停止本地服务。

第一次只建议做三件事：

1. 在 **Manage** 中建立一个真实项目，并添加一个带预计时间的直接任务。
2. 回到 **Dashboard** 查看所有项目的长期进度。
3. 需要开始工作时，进入 **Focus** 设置一个具体的下一步行动。

不需要先把整个人生录入系统。

### 页面结构

- **Dashboard**：左侧提供每日标语、重复任务和 Daily Essentials，并和主内容一起正常滚动；重复任务和 Essentials 每次打开默认折叠，本次使用期间可自由展开。Today’s #1 位于顶部介绍文字右侧；Flexible Boards 与可切换一个月／三个月／半年／一年的完成方块图并排显示，随后是分类项目进度和月历。首次默认半年，此后会记住上次选择。Daily Essentials 全部完成时会显示“今天已经足够”的横幅。
- **Routines**：分开管理每日任务与“每周完成几次”的目标，并按日期查看、补记或撤销历史记录。
- **Boards**：独立管理临时事项、生活想法和消遣清单；支持多看板、四象限模板、自定义列、卡片完成以及组内／跨组拖动。
- **Mottos**：管理希望反复看到的标语。系统采用无重复随机轮换，每轮让所有标语各出现一次，并在条件允许时避开前四天出现过的标语。
- **Focus**：设置当前任务和下一步行动；发现关联问题时，可以暂存支线或主动切换，并在完成后返回原任务。
- **Manage**：使用精简分类列表管理项目；点击大类名称可以重命名或删除空的大类，项目可以拖动或通过下拉框移动到其他大类。点击项目后从右侧抽屉管理直接交付任务与 Supporting Work，并查看交付进度、累计投入、预计剩余和支持性投入。

### 数据保存与数据库

当前版本**没有独立数据库**。数据保存在当前浏览器的 `localStorage` 中：

- 刷新或重启电脑后数据仍然存在。
- 换浏览器、清除浏览器数据或换设备时不会自动同步。
- 请在 **Manage → Export JSON** 定期导出完整备份。
- **Import JSON** 可以恢复备份，CSV 用于导出 Daily Log。

未来需要手机、平板和电脑同步时，可以把本地存储替换为 Spring Boot API 与 PostgreSQL 数据库。

### 当前功能

- 大类 → 项目 → 交付分组 → 可无限嵌套任务的结构；所有最底层交付任务按照可修改的预计时间全局加权，Dashboard 自动重新计算项目百分比
- 实际时间保存为可修改、可删除并带日期与说明的逐条记录；实际耗时不会改变交付百分比
- Supporting Work 独立记录学习、研究、调查、排错、规划、沟通、整理和探索时间，只进入累计投入，不影响项目进度
- 项目抽屉集中显示交付进度、累计投入、交付预计剩余和支持性投入；每个任务都支持 Description
- 父任务自动汇总预计时间、实际工作记录和剩余时间；任务树支持展开、收起与安全删除
- 每日最高优先级 Today’s #1
- 支持日期、可选时间和每日安排的本地月历
- 每日任务与不限固定星期几的每周次数目标（达到目标后停止增加）、可回填的每日记录、日历顶部的今日摘要、每个日期格的历史完成数量，以及固定高度的一个月／三个月／半年／一年完成方块图
- 日历计划支持新增、修改和删除；删除重复任务会同时清除其完成记录，避免统计残留
- 每日随机标语及保证完整轮换的标语库
- 可自由增减的 Daily Essentials，以及全部完成后的温和结束提示
- Flexible Boards 完成数量作为日历中的第三类 Items 记录，但不计入 Routine Activity
- 下一步行动、预计用时和开始前感受
- 任务支线的暂存、主动切换与返回提醒
- 手动时间记录和开始／停止计时
- Core Work、Support、Admin、Planning、Social、Recovery、Friction 七类统计
- 计时结束后的“更容易／符合预期／更困难”校准记录
- Done This Week、本周项目占比和历史周切换
- JSON 完整备份／恢复与 CSV 导出

### 暂时不包含

账号、云同步、AI 自动分析、物品库存、外部日历集成、连续打卡、医学诊断或综合效率评分。保持较小范围是为了避免让管理系统本身成为新的负担。

---

## English

Visible Life Console is a local-first external working memory. It keeps long-term progress, completed evidence, and the next visible action in view without turning life into a productivity score.

### First use

Double-click `start-visible-life-console.cmd`. Your browser will open `http://127.0.0.1:4173`. Keep the terminal window open while using the console; close it to stop the local server.

For the first session:

1. Create one real project and add one direct task with an estimate in **Manage**.
2. Return to **Dashboard** to see the complete long-term progress overview.
3. When you are ready to work, use **Focus** to define one concrete next action.

You do not need to enter your whole life before the dashboard becomes useful.

### Navigation

- **Dashboard** has a normally scrolling sidebar for the daily motto, repeating tasks, and Daily Essentials. Repeating tasks and Essentials start collapsed on every visit and can be expanded for the current session. Today’s #1 sits to the right of the introductory message; Flexible Boards sits beside the activity map, which switches between one month, three months, six months, and one year. Categorized project progress and the monthly calendar follow. The activity map defaults to six months and remembers the last selection. Completing every Daily Essential reveals a calm “enough for today” banner.
- **Routines** separately manages daily tasks and weekly frequency targets, with a dated history for reviewing, backfilling, or undoing checks.
- **Boards** independently holds temporary errands, life ideas, and leisure collections, with multiple boards, a priority-matrix template, custom columns, completion, and within/across-column dragging.
- **Mottos** manages reminders you want to see repeatedly. A shuffle-bag rotation shows every motto once per cycle and, when possible, avoids anything shown in the previous four days.
- **Focus** holds the current task and next action. Related problems can be parked or entered intentionally without losing the return point.
- **Manage** uses a compact category list. Category names can be edited, empty categories can be deleted, and projects can be moved by drag-and-drop or a category selector. Selecting a project opens a right-side detail drawer for direct deliverables and Supporting Work, with delivery progress, total investment, estimated remaining time, and supporting investment.

### Storage and database

This version has **no standalone database**. It stores data in the current browser’s `localStorage`:

- Data survives page refreshes and computer restarts.
- It does not automatically follow you to another browser or device.
- Use **Manage → Export JSON** for a complete backup.
- **Import JSON** restores a backup; CSV export contains the Daily Log.

A later multi-device version can replace local storage with a Spring Boot API and PostgreSQL database.

### Included

- Category → Project → Deliverable Group → unlimited nested tasks; all delivery leaf tasks are globally weighted by editable estimates and Dashboard progress recalculates automatically
- Actual time is stored as editable, removable dated entries with notes and never changes delivery progress
- Supporting Work records learning, research, investigation, troubleshooting, planning, communication, organisation, and exploration time without affecting progress
- The project drawer shows delivery progress, total investment, delivery remaining, and supporting investment; every task includes a Description field
- Parent roll-ups for estimated, logged, and remaining time, with collapsible task trees and protected subtree deletion
- One daily priority
- A monthly calendar with dated and optionally timed plans
- Daily tasks and capped weekly frequency targets, backfillable dated records, a today summary plus per-day completion counts in the calendar, and fixed-height one-month/three-month/six-month/year activity heatmaps
- Calendar plans can be added, edited, or deleted; deleting a routine also removes its completion records so statistics do not retain orphaned data
- A daily motto and a complete shuffled rotation of the motto collection
- Freely editable Daily Essentials and a gentle completion banner
- Flexible Board completions appear as a third Items count in the calendar but do not affect Routine Activity
- Next action, expected time, and starting difficulty
- Parked and intentional task branches with a return cue
- Manual activity logging and a timer
- Seven factual time categories
- One-tap expected-versus-actual reflection
- Weekly evidence, project share, and historical week navigation
- JSON backup/restore and CSV export

### Deliberately excluded for now

Accounts, cloud sync, AI analysis, inventory, external calendar integration, streaks, medical diagnosis, and an overall efficiency score.

Developer instructions are in [DEVELOPMENT.md](DEVELOPMENT.md), and the original product notes remain in [draft.md](draft.md).
