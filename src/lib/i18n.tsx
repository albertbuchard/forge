import { createContext, useContext, useMemo, type ReactNode } from "react";

export type AppLocale = "en" | "fr";

type DictionaryTree = {
  [key: string]: string | DictionaryTree;
};

type LeafPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends DictionaryTree
      ? LeafPaths<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

function createEnglishDictionary() {
  return {
    common: {
      actions: {
        cancel: "Cancel",
        close: "Close",
        create: "Create",
        edit: "Edit",
        inspect: "Inspect",
        open: "Open",
        refresh: "Refresh",
        retry: "Retry",
        save: "Save",
        reset: "Reset filters",
        view: "View"
      },
      labels: {
        loading: "Loading",
        backgroundActivity: "Background activity",
        syncInProgress: "Sync in progress",
        connectionState: "Connection state",
        errorCode: "Error code: {code}",
        noDate: "No date",
        noProject: "No project linked",
        noGoal: "No life goal linked",
        noExecutionNote: "No execution note attached yet.",
        noRunNote: "No run note recorded.",
        released: "Released",
        stable: "Stable",
        timedOut: "Timed out",
        waiting: "Waiting",
        today: "Today"
      },
      enums: {
        taskStatus: {
          backlog: "Backlog",
          focus: "Focus",
          in_progress: "In progress",
          blocked: "Blocked",
          done: "Done"
        },
        priority: {
          critical: "Critical",
          high: "High",
          medium: "Medium",
          low: "Low"
        },
        effort: {
          marathon: "Marathon",
          deep: "Deep",
          light: "Light"
        },
        energy: {
          high: "High",
          steady: "Steady",
          low: "Low"
        },
        projectStatus: {
          active: "Active",
          paused: "Paused",
          completed: "Completed"
        },
        goalHorizon: {
          quarter: "Quarter",
          year: "Year",
          lifetime: "Lifetime"
        }
      },
      shell: {
        appName: "The Kinetic Forge",
        appMark: "FORGE",
        more: "More",
        command: "Command",
        moreRoutesEyebrow: "More routes",
        moreRoutesTitle: "Move through Forge",
        moreRoutesDescription: "Use this sheet for secondary destinations so the bottom bar stays clean and easy to use.",
        loadingEyebrow: "Forge shell",
        loadingTitle: "Loading Forge",
        loadingDescription: "Checking your operator session and loading your latest snapshot.",
        sessionEyebrow: "Forge operator session",
        stateEyebrow: "Forge state",
        settled: "Up to date",
        savingOne: "Saving {count} change",
        savingOther: "Saving {count} changes",
        refreshingOne: "Refreshing {count} view",
        refreshingOther: "Refreshing {count} views",
        collapseSidebar: "Collapse sidebar",
        expandSidebar: "Expand sidebar",
        rail: {
          taskBackToKanban: "Back to Kanban",
          taskOpenToday: "Open Today",
          projectAll: "All projects",
          projectGoals: "Goal architecture",
          goalAll: "All goals",
          goalProjects: "Active projects",
          psycheHub: "Psyche hub",
          psycheReports: "Reports",
          overview: "Overview",
          today: "Today"
        },
        momentum: {
          title: "Momentum",
          streak: "Streak",
          xp: "XP",
          momentum: "Momentum",
          streakBadgeOne: "{count} day streak",
          streakBadgeOther: "{count} day streak",
          weeklyXp: "{count} weekly XP",
          liveMomentum: "{count}% momentum",
          psycheMode: "Psyche active"
        }
      },
      routeLabels: {
        overview: "Overview",
        goals: "Goals",
        projects: "Projects",
        kanban: "Kanban",
        today: "Today",
        psyche: "Psyche",
        activity: "Activity",
        insights: "Insights",
        review: "Review",
        settings: "Settings"
      },
      routeDetails: {
        overview: "See priorities, momentum, and recent evidence in one place.",
        goals: "Keep long-term direction connected to day-to-day work.",
        projects: "Track the initiatives currently moving your goals forward.",
        kanban: "Move active work across the board without losing context.",
        today: "Focus today on the clearest next move.",
        psyche: "Reflect on values, patterns, and reports with structure.",
        activity: "Review the visible audit trail of what changed and when.",
        insights: "Store and review coaching, analysis, and recommendations.",
        review: "Review the week and set the next push.",
        settings: "Manage collaboration, safety, and operator preferences."
      },
    navigation: {
      openRoute: "Open {label}",
      create: "Create",
      createTitle: "Create in Forge",
      createDescription: "Choose what you want to add next.",
        closeCreateMenu: "Close create menu",
        newGoal: "New life goal",
        newGoalDescription: "Define a long-term direction.",
        newProject: "New project",
        newProjectDescription: "Add a concrete initiative under a life goal.",
      newTask: "New task",
      newTaskDescription: "Capture the next actionable step in a project."
    },
    commandPalette: {
      searchPlaceholder: "Jump to a route, goal, project, or focus task",
      noResults: "No command matches this search yet.",
      categoryRoute: "Route",
      categoryGoal: "Goal",
      categoryProject: "Project",
      categoryTask: "Task",
      routeOverview: "Open the overview.",
      routeToday: "Open today.",
      routeKanban: "Open the board.",
      routePsyche: "Open Psyche.",
      routeGoals: "Open your life goals.",
      routeProjects: "Open your projects.",
      routeReview: "Open weekly review.",
      routeSettings: "Open settings.",
      openLifeGoal: "Open life goal",
      openFocusTask: "Open focus task"
    },
      pageState: {
        loadingTitle: "Getting things ready",
        loadingDescription: "Loading the latest Forge data for this view."
      },
      settings: {
        localeLabel: "Language",
        localeDescription: "Choose the language used throughout Forge.",
        localeEnglish: "English",
        localeFrench: "French",
        localeSaved: "Language saved"
      },
      overview: {
        heroEyebrow: "Strategic overview",
        heroEmptyTitle: "Ready to get started",
        heroDescription: "See your goals, active projects, current tasks, and recent evidence in one place.",
        emptyTitle: "No overview yet",
        emptyDescription: "Create a life goal, project, or task to give Forge something real to organize.",
        emptyAction: "Open life goals",
        commandEyebrow: "Command surface",
        commandTitle: "Now, next, risks, and recent proof",
        commandDescription: "See what needs attention now, what comes next, where drift is appearing, and what progress is already visible.",
        sectionGoals: "Active life goals",
        sectionProjects: "Active projects",
        sectionFocus: "Today's focus",
        sectionEvidence: "Recent evidence",
        sectionMomentum: "Momentum core",
        sectionAttention: "Needs attention",
        noGoals: "No life goals are active yet. Start by defining the direction you want Forge to support.",
        noProjects: "No active projects yet. Add a project to turn a goal into practical work.",
        noFocus: "No focus tasks yet. Promote a task when you know what deserves attention next.",
        noEvidence: "No evidence has been recorded yet. Completed work and logged activity will appear here.",
        noProjectYet: "No project yet",
        noAttention: "No major drift signal right now. Forge will raise neglected goals here when they start slipping.",
        metricsLevel: "Level",
        metricsWeeklyXp: "Weekly XP",
        metricsFocusTasks: "Focus tasks",
        metricsOverdue: "Overdue"
      },
      todayPage: {
        heroEyebrow: "Today",
        heroEmptyTitle: "No daily direction yet",
        heroDescription: "Start a task, earn XP, and keep today's work clear.",
        emptyTitle: "No daily runway yet",
        emptyDescription: "Add goals, tasks, or reward targets so Forge can shape a useful day plan.",
        emptyAction: "Open life goals",
        commandEyebrow: "Today command",
        commandTitle: "Directive, daily quests, recovery, and finish line",
        commandDescription: "See the next useful move clearly and keep the day grounded in real work.",
        questsTitle: "Daily quests",
        questsEmpty: "No daily quests yet. They will appear once Forge has enough live work and reward context.",
        rewardsTitle: "Milestone rewards",
        rewardsEmpty: "No milestone rewards are active yet. Long-term rewards will appear here as progress structure grows.",
        signalDirective: "Directive",
        signalQuest: "Quest chain",
        signalComeback: "Recovery",
        signalFinish: "Finish line",
        noDirective: "Choose one clear task to anchor the day.",
        noQuest: "No active daily quest chain",
        noQuestDetail: "Daily quests should reinforce real work, not distract from it.",
        noComeback: "Recovery window is clear",
        noFinish: "Keep the day clean",
        noDirectiveDetail: "Promote a real task and Today will become sharper immediately.",
        noFinishDetail: "A good finish today should make tomorrow lighter, not noisier."
      },
      kanban: {
        heroEyebrow: "Task board",
        heroTitle: "Task board",
        heroDescription: "Use the board to move active work, review blocked items, and open task details when you need more context.",
        emptyTitle: "No board yet",
        emptyDescription: "Create your first task inside a project to start using the board.",
        emptyAction: "Open life goals",
        healthEyebrow: "Board status",
        healthTitle: "Visible work, focus, blockers, and completed work",
        healthDescription: "See what is active, what needs attention, and what has already been completed.",
        visibleWork: "Visible work",
        focusWork: "Current focus",
        blockedWork: "Blocked work",
        completedWork: "Completed work",
        visibleDetail: "{hidden} tasks are outside the current filters.",
        focusDetailReady: "These are the tasks most ready to be picked up next.",
        focusDetailEmpty: "Move one backlog task into focus to make the board more useful.",
        blockedDetail: "These tasks need a decision, an unblock, or a reset before they can move again.",
        blockedDetailEmpty: "No blocked tasks right now.",
        doneDetail: "Completed work stays here until you review it or reopen it.",
        doneDetailEmpty: "Nothing has been completed on this board yet.",
        boardFilters: "Board filters",
        filterGoal: "Goal",
        filterOwner: "Owner",
        allGoals: "All goals",
        allOwners: "All owners",
        noTasksMatch: "No tasks match these filters",
        noTasksMatchDescription: "These filters hide every task. Reset them to see the full board again.",
        taskContext: "Task details",
        evidence: "Recent activity",
        runHistory: "Run history",
        noTaskEvidence: "No activity has been recorded for this task yet.",
        noRunHistory: "No runs have been recorded for this task yet.",
        taskPlacement: "Task placement",
        projectLabel: "Project: {value}",
        goalLabel: "Life goal: {value}",
        ownerLabel: "Owner: {value}",
        dueLabel: "Due: {value}",
        openTask: "Open task",
        openProject: "Open project",
        openGoal: "Open life goal",
        noProjectLinked: "No project linked",
        noGoalLinked: "No life goal linked"
      },
      dailyRunway: {
        runwayEyebrow: "Today",
        runwayTitle: "Tasks for today",
        prioritiesOne: "{count} task",
        prioritiesOther: "{count} tasks",
        unassigned: "Unassigned",
        runwayItem: "Task {index}",
        noNote: "No note yet.",
        inspect: "Open task",
        actionBacklog: "Start",
        actionFocus: "Start",
        actionProgress: "Done",
        actionBlocked: "Start",
        timelineEyebrow: "By status",
        timelineTitle: "Tasks by status",
        emptyBucket: "Nothing here right now."
      },
      executionBoard: {
        laneBacklogTitle: "Backlog",
        laneBacklogDetail: "Not started yet",
        laneFocusTitle: "Focus",
        laneFocusDetail: "Ready to work on",
        laneProgressTitle: "In progress",
        laneProgressDetail: "Currently moving",
        laneBlockedTitle: "Blocked",
        laneBlockedDetail: "Needs attention",
        laneDoneTitle: "Done",
        laneDoneDetail: "Completed",
        noExecutionNote: "No note yet.",
        reopen: "Reopen",
        emptyLane: "No tasks in this lane."
      },
      weeklyReview: {
        heroEyebrow: "Weekly review",
        heroDescription: "Review the week, note what moved, and decide what needs attention next.",
        summaryEyebrow: "Weekly summary",
        summaryTitle: "This week, wins, recovery, and next steps",
        summaryDescription: "Use this review to understand what happened this week and choose the most useful next move.",
        sectionMomentum: "Momentum summary",
        sectionGoals: "Goal check-in",
        sectionWins: "Wins",
        completionBonus: "Completion bonus",
        finalize: "Finish review",
        noWin: "No win recorded yet",
        noWinDetail: "If this week was quiet, use the review to capture one useful takeaway anyway.",
        noRecovery: "No recovery suggestion yet",
        noRecoveryDetail: "If the week felt steady, keep a light recovery option available for next week."
      },
      dialogs: {
        closeDialog: "Close dialog",
        task: {
          eyebrow: "Task",
          createTitle: "Create task",
          editTitle: "Edit task",
          description: "Use tasks for the next concrete step inside a project. Pick the project first so Forge can keep the larger context aligned.",
          project: "Project",
          selectProject: "Select a project",
          goal: "Life goal",
          title: "Title",
          descriptionLabel: "Description",
          owner: "Owner",
          xp: "XP",
          priority: "Priority",
          status: "Status",
          effort: "Effort",
          energy: "Energy",
          dueDate: "Due date",
          tags: "Tags",
          save: "Save task",
          create: "Create task"
        },
        project: {
          eyebrow: "Project",
          createTitle: "Create project",
          editTitle: "Edit project",
          description: "Use projects to turn a life goal into a concrete stream of work with tasks, evidence, and momentum.",
          goal: "Life goal",
          selectGoal: "Select a life goal",
          title: "Title",
          descriptionLabel: "Description",
          status: "Status",
          targetXp: "Target XP",
          themeColor: "Theme color",
          save: "Save project",
          create: "Create project",
          submitError: "Project update failed."
        },
        goal: {
          eyebrow: "Life goal",
          createTitle: "Create life goal",
          editTitle: "Edit life goal",
          description: "Use life goals to define what matters over the coming months or years before you break the path into projects.",
          title: "Title",
          descriptionLabel: "Description",
          horizon: "Horizon",
          status: "Status",
          targetXp: "Target XP",
          themeColor: "Theme color",
          tags: "Life domains and context",
          save: "Save life goal",
          create: "Create life goal",
          submitError: "Goal update failed."
        }
      },
      taskDetail: {
        eyebrow: "Task",
        errorEyebrow: "Task",
        emptyPayload: "Forge returned an empty task payload.",
        heroFallback: "Use this task page to update the work, move it forward, and keep its context clear.",
        commandEyebrow: "Task overview",
        commandTitle: "What this task is, what to do next, and where it fits",
        commandDescription: "Use this page to update the task itself and understand its surrounding context clearly.",
        signalState: "State",
        signalNext: "Next move",
        signalEvidence: "Recent activity",
        signalAnchor: "Connected project",
        noStateChange: "No state change needed",
        terminalStateDetail: "This task is already in a completed state unless you decide to reopen it.",
        noEvidence: "No recent activity yet",
        noEvidenceDetail: "Completed work, corrections, and logged sessions will appear here as the task moves.",
        noAnchor: "No connected project yet",
        linkAnchorDetail: "Connect this task to a project or life goal so Forge can show why it matters.",
        edit: "Edit task",
        openProject: "Open project",
        openGoal: "Open life goal",
        markNotCompleted: "Mark not completed",
        sectionStatus: "Task status",
        fieldProject: "Project",
        fieldGoal: "Life goal",
        fieldDueDate: "Due date",
        pendingMove: "Moving",
        actionBacklog: "Move to backlog",
        actionFocus: "Move to focus",
        actionProgress: "Start now",
        actionBlocked: "Mark blocked",
        actionDone: "Mark completed",
        sectionEvidence: "Recent activity",
        noVisibleEvidence: "No activity has been recorded for this task yet.",
        removeLog: "Remove log",
        openRelatedItem: "Open related item",
        sectionRuns: "Work sessions",
        noRuns: "No work sessions have been recorded for this task yet.",
        sectionMetadata: "More task details",
        metaOwner: "Owner: {value}",
        metaEffort: "Effort: {value}",
        metaEnergy: "Energy: {value}",
        metaCreated: "Created: {value}",
        metaUpdated: "Last updated: {value}",
        metaCompleted: "Completed at: {value}",
        metaNotCompleted: "Not completed"
      },
      projectDetail: {
        errorEyebrow: "Project",
        heroEyebrow: "Project",
        commandEyebrow: "Project status",
        commandTitle: "Momentum, next task, risk, and evidence",
        commandDescription: "Use this page to see what is moving, what needs attention next, and what evidence already supports the project.",
        signalMomentum: "Momentum",
        signalNext: "Next task",
        signalRisk: "Risk",
        signalEvidence: "Evidence",
        trackedTasksOne: "{count} tracked task",
        trackedTasksOther: "{count} tracked tasks",
        noNextTask: "No next task selected yet",
        noNextTaskDetail: "Pick or create a task so the project has a clear next move.",
        needsFocus: "Needs focus",
        noRisk: "No immediate risk signal",
        noRiskDetail: "Blocked or neglected work will appear here when the project starts drifting.",
        noEvidence: "No recent evidence yet",
        noEvidenceDetail: "Completed work and logged activity will appear here as the project moves.",
        compatibility: "Compatibility mode",
        compatibilityDescription: "This project comes from an older snapshot format. You can review it here, but editing the project itself needs the updated backend.",
        addTask: "Add task",
        editProject: "Edit project",
        openGoal: "Open life goal",
        sectionHealth: "Project health",
        fieldStatus: "Status",
        fieldProgress: "Progress",
        fieldMomentum: "Momentum",
        sectionEvidence: "Recent evidence"
      },
      goalDetail: {
        eyebrow: "Life goal",
        missingTitle: "This life goal is not available",
        missingDescription: "Forge cannot find this life goal in the current snapshot. Return to the goals view and choose an active one.",
        backToGoals: "Back to goals",
        heroBadgeOne: "{count} project",
        heroBadgeOther: "{count} projects",
        commandEyebrow: "Goal status",
        commandTitle: "Progress, next push, risk, and evidence",
        commandDescription: "Use this page to see what is advancing the goal, what should move next, and where support is needed.",
        signalProgress: "Progress",
        signalNext: "Next push",
        signalRisk: "Risk",
        signalEvidence: "Evidence",
        progressTitle: "{progress}% with {count} completed tasks",
        progressDetail: "{xp} XP is already banked on this goal.",
        noProject: "No active project yet",
        noProjectDetail: "Add a project so this goal has a concrete execution path.",
        needsProject: "Needs project",
        nextMove: "Next move: {value}",
        noRisk: "No drift signal right now",
        noRiskDetail: "If this goal starts slipping, Forge will surface that pressure here.",
        noEvidence: "No recent evidence yet",
        noEvidenceDetail: "Completed tasks, project motion, and agent actions will appear here as proof of progress.",
        edit: "Edit life goal",
        addProject: "Add project",
        sectionProjects: "Projects advancing this goal",
        noProjects: "This goal does not have an active project yet. Add one to turn the goal into practical motion.",
        addNextTask: "Add the next task",
        sectionHealth: "Goal health",
        fieldProgress: "Progress",
        fieldCompletedTasks: "Completed tasks",
        fieldXpBanked: "XP banked",
        sectionEvidence: "Recent evidence",
        noEvidenceLogged: "No evidence has been logged for this goal yet. Task completions, project updates, and agent actions will appear here."
      }
    }
  };
}

export const en = createEnglishDictionary();

export const fr: typeof en = {
  common: {
      actions: {
        cancel: "Annuler",
        close: "Fermer",
        create: "Créer",
        edit: "Modifier",
        inspect: "Inspecter",
        open: "Ouvrir",
      refresh: "Actualiser",
      retry: "Réessayer",
      save: "Enregistrer",
      reset: "Réinitialiser les filtres",
      view: "Voir"
    },
    labels: {
      loading: "Chargement",
      backgroundActivity: "Activité en arrière-plan",
      syncInProgress: "Synchronisation en cours",
      connectionState: "État de la connexion",
      errorCode: "Code d'erreur : {code}",
      noDate: "Aucune date",
      noProject: "Aucun projet lié",
      noGoal: "Aucun objectif de vie lié",
      noExecutionNote: "Aucune note d'exécution pour le moment.",
      noRunNote: "Aucune note d'exécution enregistrée.",
      released: "Libérée",
      stable: "Stable",
      timedOut: "Expirée",
      waiting: "En attente",
      today: "Aujourd'hui"
    },
    enums: {
      taskStatus: {
        backlog: "Backlog",
        focus: "Priorité",
        in_progress: "En cours",
        blocked: "Bloqué",
        done: "Terminé"
      },
      priority: {
        critical: "Critique",
        high: "Élevée",
        medium: "Moyenne",
        low: "Basse"
      },
      effort: {
        marathon: "Marathon",
        deep: "Approfondi",
        light: "Léger"
      },
      energy: {
        high: "Haute",
        steady: "Stable",
        low: "Basse"
      },
      projectStatus: {
        active: "Actif",
        paused: "En pause",
        completed: "Terminé"
      },
      goalHorizon: {
        quarter: "Trimestre",
        year: "Année",
        lifetime: "Vie entière"
      }
    },
    shell: {
      appName: "The Kinetic Forge",
      appMark: "FORGE",
      more: "Plus",
      command: "Commande",
      moreRoutesEyebrow: "Autres vues",
      moreRoutesTitle: "Parcourir Forge",
      moreRoutesDescription: "Utilisez ce panneau pour accéder aux vues secondaires sans surcharger la barre inférieure.",
      loadingEyebrow: "Forge",
      loadingTitle: "Chargement de Forge",
      loadingDescription: "Vérification de votre session opérateur et chargement du dernier instantané.",
      sessionEyebrow: "Session opérateur Forge",
      stateEyebrow: "État de Forge",
      settled: "À jour",
      savingOne: "Enregistrement de {count} modification",
      savingOther: "Enregistrement de {count} modifications",
      refreshingOne: "Actualisation de {count} vue",
      refreshingOther: "Actualisation de {count} vues",
      collapseSidebar: "Réduire la barre latérale",
      expandSidebar: "Déployer la barre latérale",
      rail: {
        taskBackToKanban: "Retour au Kanban",
        taskOpenToday: "Ouvrir Aujourd'hui",
        projectAll: "Tous les projets",
        projectGoals: "Architecture des objectifs",
        goalAll: "Tous les objectifs",
        goalProjects: "Projets actifs",
        psycheHub: "Hub Psyche",
        psycheReports: "Rapports",
        overview: "Vue d'ensemble",
        today: "Aujourd'hui"
      },
      momentum: {
        title: "Momentum",
        streak: "Série",
        xp: "XP",
        momentum: "Momentum",
        streakBadgeOne: "{count} jour de série",
        streakBadgeOther: "{count} jours de série",
        weeklyXp: "{count} XP cette semaine",
        liveMomentum: "{count}% de momentum",
        psycheMode: "Psyche active"
      }
    },
    routeLabels: {
      overview: "Vue d'ensemble",
      goals: "Objectifs",
      projects: "Projets",
      kanban: "Kanban",
      today: "Aujourd'hui",
      psyche: "Psyche",
      activity: "Activité",
      insights: "Insights",
      review: "Revue",
      settings: "Réglages"
    },
    routeDetails: {
      overview: "Voyez les priorités, le momentum et les preuves récentes au même endroit.",
      goals: "Reliez la direction long terme au travail du quotidien.",
      projects: "Suivez les initiatives qui font avancer vos objectifs.",
      kanban: "Faites progresser le travail actif sans perdre le contexte.",
      today: "Concentrez aujourd'hui sur le prochain mouvement le plus net.",
      psyche: "Réfléchissez avec structure sur vos valeurs, vos schémas et vos rapports.",
      activity: "Relisez la trace visible de ce qui a changé et quand.",
      insights: "Stockez et relisez coaching, analyses et recommandations.",
      review: "Relisez la semaine et préparez la prochaine poussée.",
      settings: "Gérez la collaboration, la sécurité et vos préférences."
    },
    navigation: {
      openRoute: "Ouvrir {label}",
      create: "Créer",
      createTitle: "Créer dans Forge",
      createDescription: "Choisissez ce que vous voulez ajouter ensuite.",
      closeCreateMenu: "Fermer le menu de création",
      newGoal: "Nouvel objectif de vie",
      newGoalDescription: "Définir une direction à long terme.",
      newProject: "Nouveau projet",
      newProjectDescription: "Ajouter une initiative concrète sous un objectif de vie.",
      newTask: "Nouvelle tâche",
      newTaskDescription: "Capturer la prochaine étape actionnable dans un projet."
    },
    commandPalette: {
      searchPlaceholder: "Aller à une vue, un objectif, un projet ou une tâche prioritaire",
      noResults: "Aucune commande ne correspond à cette recherche.",
      categoryRoute: "Vue",
      categoryGoal: "Objectif",
      categoryProject: "Projet",
      categoryTask: "Tâche",
      routeOverview: "Ouvrir la vue d'ensemble.",
      routeToday: "Ouvrir aujourd'hui.",
      routeKanban: "Ouvrir le tableau.",
      routePsyche: "Ouvrir Psyche.",
      routeGoals: "Ouvrir vos objectifs de vie.",
      routeProjects: "Ouvrir vos projets.",
      routeReview: "Ouvrir la revue hebdomadaire.",
      routeSettings: "Ouvrir les réglages.",
      openLifeGoal: "Ouvrir l'objectif de vie",
      openFocusTask: "Ouvrir la tâche prioritaire"
    },
    pageState: {
      loadingTitle: "Préparation en cours",
      loadingDescription: "Chargement des dernières données Forge pour cette vue."
    },
    settings: {
      localeLabel: "Langue",
      localeDescription: "Choisissez la langue utilisée dans Forge.",
      localeEnglish: "Anglais",
      localeFrench: "Français",
      localeSaved: "Langue enregistrée"
    },
    overview: {
      heroEyebrow: "Vue stratégique",
      heroEmptyTitle: "Prêt à démarrer",
      heroDescription: "Voyez vos objectifs, projets actifs, tâches en cours et preuves récentes au même endroit.",
      emptyTitle: "Pas encore de vue d'ensemble",
      emptyDescription: "Créez un objectif de vie, un projet ou une tâche pour donner à Forge une base réelle.",
      emptyAction: "Ouvrir les objectifs de vie",
      commandEyebrow: "Vue de commande",
      commandTitle: "Maintenant, ensuite, risques et preuves récentes",
      commandDescription: "Cette vue doit montrer ce qui mérite votre attention maintenant, ce qui vient ensuite, où la dérive apparaît et les progrès déjà visibles.",
      sectionGoals: "Objectifs de vie actifs",
      sectionProjects: "Projets actifs",
      sectionFocus: "Priorité du jour",
      sectionEvidence: "Preuves récentes",
      sectionMomentum: "Noyau de momentum",
      sectionAttention: "À surveiller",
      noGoals: "Aucun objectif de vie actif pour le moment. Commencez par définir la direction que Forge doit soutenir.",
      noProjects: "Aucun projet actif. Ajoutez un projet pour transformer un objectif en travail concret.",
      noFocus: "Aucune tâche prioritaire pour le moment. Faites passer une tâche en priorité quand vous savez quoi faire ensuite.",
      noEvidence: "Aucune preuve enregistrée pour le moment. Le travail accompli et l'activité journalisée apparaîtront ici.",
      noProjectYet: "Pas encore de projet",
      noAttention: "Aucun signal majeur de dérive pour le moment. Forge affichera ici les objectifs négligés.",
      metricsLevel: "Niveau",
      metricsWeeklyXp: "XP hebdo",
      metricsFocusTasks: "Tâches prioritaires",
      metricsOverdue: "En retard"
    },
    todayPage: {
      heroEyebrow: "Aujourd'hui",
      heroEmptyTitle: "Pas encore de direction du jour",
      heroDescription: "Commencez une tâche, gagnez de l'XP et gardez la journée claire.",
      emptyTitle: "Pas encore de piste du jour",
      emptyDescription: "Ajoutez des objectifs, des tâches ou des cibles de récompense pour que Forge puisse construire une journée utile.",
      emptyAction: "Ouvrir les objectifs de vie",
      commandEyebrow: "Commande du jour",
      commandTitle: "Directive, quêtes du jour, reprise et ligne d'arrivée",
      commandDescription: "Aujourd'hui doit rendre le prochain mouvement utile évident et garder la journée ancrée dans un vrai travail.",
      questsTitle: "Quêtes du jour",
      questsEmpty: "Pas encore de quêtes du jour. Elles apparaîtront quand Forge aura assez de travail réel et de contexte de récompense.",
      rewardsTitle: "Récompenses jalons",
      rewardsEmpty: "Aucune récompense jalon active pour le moment. Elles apparaîtront à mesure que la structure de progression se précise.",
      signalDirective: "Directive",
      signalQuest: "Chaîne de quêtes",
      signalComeback: "Reprise",
      signalFinish: "Ligne d'arrivée",
      noDirective: "Choisissez une tâche claire pour ancrer la journée.",
      noQuest: "Aucune chaîne de quêtes active",
      noQuestDetail: "Les quêtes du jour doivent renforcer le vrai travail, pas le détourner.",
      noComeback: "La fenêtre de reprise est claire",
      noFinish: "Gardez la journée nette",
      noDirectiveDetail: "Faites passer une vraie tâche en priorité et la vue Aujourd'hui deviendra plus nette.",
      noFinishDetail: "Une bonne fin de journée doit alléger demain, pas l'encombrer."
    },
    kanban: {
      heroEyebrow: "Tableau des tâches",
      heroTitle: "Tableau des tâches",
      heroDescription: "Utilisez le tableau pour faire avancer le travail actif, revoir les blocages et ouvrir les détails quand nécessaire.",
      emptyTitle: "Pas encore de tableau",
      emptyDescription: "Créez votre première tâche dans un projet pour commencer à utiliser le tableau.",
      emptyAction: "Ouvrir les objectifs de vie",
      healthEyebrow: "État du tableau",
      healthTitle: "Travail visible, priorité, blocages et travail terminé",
      healthDescription: "Le tableau doit montrer ce qui est actif, ce qui demande de l'attention et ce qui est déjà terminé.",
      visibleWork: "Travail visible",
      focusWork: "Priorité actuelle",
      blockedWork: "Travail bloqué",
      completedWork: "Travail terminé",
      visibleDetail: "{hidden} tâches sont hors des filtres actuels.",
      focusDetailReady: "Ce sont les tâches les plus prêtes à être reprises maintenant.",
      focusDetailEmpty: "Faites passer une tâche du backlog en priorité pour rendre le tableau plus utile.",
      blockedDetail: "Ces tâches ont besoin d'une décision, d'un déblocage ou d'une remise à plat avant d'avancer.",
      blockedDetailEmpty: "Aucune tâche bloquée pour le moment.",
      doneDetail: "Le travail terminé reste ici jusqu'à sa revue ou sa réouverture.",
      doneDetailEmpty: "Rien n'a encore été terminé sur ce tableau.",
      boardFilters: "Filtres du tableau",
      filterGoal: "Objectif",
      filterOwner: "Responsable",
      allGoals: "Tous les objectifs",
      allOwners: "Tous les responsables",
      noTasksMatch: "Aucune tâche ne correspond à ces filtres",
      noTasksMatchDescription: "Ces filtres masquent toutes les tâches. Réinitialisez-les pour revoir l'ensemble du tableau.",
      taskContext: "Détails de la tâche",
      evidence: "Activité récente",
      runHistory: "Historique d'exécution",
      noTaskEvidence: "Aucune activité n'a encore été enregistrée pour cette tâche.",
      noRunHistory: "Aucune exécution n'a encore été enregistrée pour cette tâche.",
      taskPlacement: "Placement de la tâche",
      projectLabel: "Projet : {value}",
      goalLabel: "Objectif de vie : {value}",
      ownerLabel: "Responsable : {value}",
      dueLabel: "Échéance : {value}",
      openTask: "Ouvrir la tâche",
      openProject: "Ouvrir le projet",
      openGoal: "Ouvrir l'objectif de vie",
      noProjectLinked: "Aucun projet lié",
      noGoalLinked: "Aucun objectif de vie lié"
    },
    dailyRunway: {
      runwayEyebrow: "Aujourd'hui",
      runwayTitle: "Tâches du jour",
      prioritiesOne: "{count} tâche",
      prioritiesOther: "{count} tâches",
      unassigned: "Non attribué",
      runwayItem: "Tâche {index}",
      noNote: "Aucune note pour le moment.",
      inspect: "Ouvrir la tâche",
      actionBacklog: "Commencer",
      actionFocus: "Commencer",
      actionProgress: "Terminer",
      actionBlocked: "Commencer",
      timelineEyebrow: "Par statut",
      timelineTitle: "Tâches par statut",
      emptyBucket: "Rien ici pour le moment."
    },
    executionBoard: {
      laneBacklogTitle: "Backlog",
      laneBacklogDetail: "Pas encore commencé",
      laneFocusTitle: "Priorité",
      laneFocusDetail: "Prêt à être traité",
      laneProgressTitle: "En cours",
      laneProgressDetail: "En mouvement",
      laneBlockedTitle: "Bloqué",
      laneBlockedDetail: "Demande de l'attention",
      laneDoneTitle: "Terminé",
      laneDoneDetail: "Achevé",
      noExecutionNote: "Aucune note pour le moment.",
      reopen: "Rouvrir",
      emptyLane: "Aucune tâche dans cette colonne."
    },
    weeklyReview: {
      heroEyebrow: "Revue hebdomadaire",
      heroDescription: "Relisez la semaine, notez ce qui a avancé et décidez de ce qui demande de l'attention ensuite.",
      summaryEyebrow: "Résumé hebdomadaire",
      summaryTitle: "Cette semaine, les progrès, la récupération et la suite",
      summaryDescription: "Utilisez cette revue pour comprendre la semaine et choisir le prochain mouvement utile.",
      sectionMomentum: "Résumé du momentum",
      sectionGoals: "Point sur les objectifs",
      sectionWins: "Progrès",
      completionBonus: "Bonus de complétion",
      finalize: "Terminer la revue",
      noWin: "Aucun progrès enregistré",
      noWinDetail: "Même si la semaine a été calme, notez au moins un apprentissage utile.",
      noRecovery: "Aucune suggestion de récupération",
      noRecoveryDetail: "Si la semaine a été stable, gardez malgré tout une option légère de récupération."
    },
    dialogs: {
      closeDialog: "Fermer la fenêtre",
      task: {
        eyebrow: "Tâche",
        createTitle: "Créer une tâche",
        editTitle: "Modifier la tâche",
        description: "Utilisez les tâches pour représenter la prochaine étape concrète dans un projet. Choisissez d'abord le projet pour garder le bon contexte.",
        project: "Projet",
        selectProject: "Sélectionner un projet",
        goal: "Objectif de vie",
        title: "Titre",
        descriptionLabel: "Description",
        owner: "Responsable",
        xp: "XP",
        priority: "Priorité",
        status: "Statut",
        effort: "Effort",
        energy: "Énergie",
        dueDate: "Date d'échéance",
        tags: "Tags",
        save: "Enregistrer la tâche",
        create: "Créer la tâche"
      },
      project: {
        eyebrow: "Projet",
        createTitle: "Créer un projet",
        editTitle: "Modifier le projet",
        description: "Utilisez les projets pour transformer un objectif de vie en flux de travail concret avec tâches, preuves et momentum.",
        goal: "Objectif de vie",
        selectGoal: "Sélectionner un objectif de vie",
        title: "Titre",
        descriptionLabel: "Description",
        status: "Statut",
        targetXp: "XP cible",
        themeColor: "Couleur du thème",
        save: "Enregistrer le projet",
        create: "Créer le projet",
        submitError: "La mise à jour du projet a échoué."
      },
      goal: {
        eyebrow: "Objectif de vie",
        createTitle: "Créer un objectif de vie",
        editTitle: "Modifier l'objectif de vie",
        description: "Utilisez les objectifs de vie pour définir ce qui compte sur les mois ou les années à venir avant de le décliner en projets.",
        title: "Titre",
        descriptionLabel: "Description",
        horizon: "Horizon",
        status: "Statut",
        targetXp: "XP cible",
        themeColor: "Couleur du thème",
        tags: "Domaines de vie et contexte",
        save: "Enregistrer l'objectif de vie",
        create: "Créer l'objectif de vie",
        submitError: "La mise à jour de l'objectif a échoué."
      }
    },
    taskDetail: {
      eyebrow: "Tâche",
      errorEyebrow: "Tâche",
      emptyPayload: "Forge a renvoyé une charge utile de tâche vide.",
      heroFallback: "Utilisez cette page pour mettre à jour la tâche, la faire avancer et garder son contexte clair.",
      commandEyebrow: "Commande de tâche",
      commandTitle: "Statut, prochaine action, preuves et contexte",
      commandDescription: "Cette page doit aider à modifier directement la tâche et à comprendre clairement son contexte.",
      signalState: "Statut",
      signalNext: "Prochaine action",
      signalEvidence: "Activité récente",
      signalAnchor: "Projet lié",
      noStateChange: "Aucun changement d'état nécessaire",
      terminalStateDetail: "Cette tâche est déjà dans un état terminé, sauf si vous décidez de la rouvrir.",
      noEvidence: "Aucune activité récente pour le moment",
      noEvidenceDetail: "Le travail terminé, les corrections et les sessions apparaîtront ici à mesure que la tâche avance.",
      noAnchor: "Aucun projet lié",
      linkAnchorDetail: "Reliez cette tâche à un projet ou à un objectif de vie pour que Forge puisse montrer pourquoi elle compte.",
      edit: "Modifier la tâche",
      openProject: "Ouvrir le projet",
      openGoal: "Ouvrir l'objectif de vie",
      markNotCompleted: "Marquer comme non terminée",
      sectionStatus: "Statut de la tâche",
      fieldProject: "Projet",
      fieldGoal: "Objectif de vie",
      fieldDueDate: "Date d'échéance",
      pendingMove: "Déplacement",
      actionBacklog: "Passer au backlog",
      actionFocus: "Passer en priorité",
      actionProgress: "Commencer maintenant",
      actionBlocked: "Marquer bloquée",
      actionDone: "Marquer terminée",
      sectionEvidence: "Activité récente",
      noVisibleEvidence: "Aucune activité n'a encore été enregistrée pour cette tâche.",
      removeLog: "Supprimer l'entrée",
      openRelatedItem: "Ouvrir l'élément lié",
      sectionRuns: "Sessions de travail",
      noRuns: "Aucune session de travail n'a encore été enregistrée pour cette tâche.",
      sectionMetadata: "Autres détails de la tâche",
      metaOwner: "Responsable : {value}",
      metaEffort: "Effort : {value}",
      metaEnergy: "Énergie : {value}",
      metaCreated: "Créée : {value}",
      metaUpdated: "Dernière mise à jour : {value}",
      metaCompleted: "Terminée le : {value}",
      metaNotCompleted: "Non terminée"
    },
    projectDetail: {
      errorEyebrow: "Projet",
      heroEyebrow: "Projet",
      commandEyebrow: "État du projet",
      commandTitle: "Momentum, prochaine tâche, risque et preuves",
      commandDescription: "Utilisez cette page pour voir ce qui avance, ce qui demande votre attention ensuite, et quelles preuves soutiennent déjà le projet.",
      signalMomentum: "Momentum",
      signalNext: "Prochaine tâche",
      signalRisk: "Risque",
      signalEvidence: "Preuves",
      trackedTasksOne: "{count} tâche suivie",
      trackedTasksOther: "{count} tâches suivies",
      noNextTask: "Aucune prochaine tâche choisie",
      noNextTaskDetail: "Choisissez ou créez une tâche pour donner au projet un prochain mouvement clair.",
      needsFocus: "Besoin de priorité",
      noRisk: "Aucun risque immédiat",
      noRiskDetail: "Le travail bloqué ou négligé apparaîtra ici si le projet commence à dériver.",
      noEvidence: "Aucune preuve récente",
      noEvidenceDetail: "Le travail terminé et l'activité enregistrée apparaîtront ici à mesure que le projet avance.",
      compatibility: "Mode de compatibilité",
      compatibilityDescription: "Ce projet provient d'un ancien format d'instantané. Vous pouvez le consulter ici, mais sa modification demande le backend mis à jour.",
      addTask: "Ajouter une tâche",
      editProject: "Modifier le projet",
      openGoal: "Ouvrir l'objectif de vie",
      sectionHealth: "Santé du projet",
      fieldStatus: "Statut",
      fieldProgress: "Progression",
      fieldMomentum: "Momentum",
      sectionEvidence: "Preuves récentes"
    },
    goalDetail: {
      eyebrow: "Objectif de vie",
      missingTitle: "Cet objectif de vie n'est pas disponible",
      missingDescription: "Forge ne trouve pas cet objectif de vie dans l'instantané actuel. Revenez à la vue des objectifs et choisissez-en un actif.",
      backToGoals: "Retour aux objectifs",
      heroBadgeOne: "{count} projet",
      heroBadgeOther: "{count} projets",
      commandEyebrow: "État de l'objectif",
      commandTitle: "Progression, prochain élan, risque et preuves",
      commandDescription: "Utilisez cette page pour voir ce qui fait avancer l'objectif, ce qui doit bouger ensuite, et où du soutien est nécessaire.",
      signalProgress: "Progression",
      signalNext: "Prochain élan",
      signalRisk: "Risque",
      signalEvidence: "Preuves",
      progressTitle: "{progress}% avec {count} tâches terminées",
      progressDetail: "{xp} XP sont déjà cumulés sur cet objectif.",
      noProject: "Aucun projet actif pour le moment",
      noProjectDetail: "Ajoutez un projet pour donner à cet objectif un chemin d'exécution concret.",
      needsProject: "Projet nécessaire",
      nextMove: "Prochaine action : {value}",
      noRisk: "Aucun signal de dérive pour le moment",
      noRiskDetail: "Si cet objectif commence à glisser, Forge affichera cette pression ici.",
      noEvidence: "Aucune preuve récente",
      noEvidenceDetail: "Les tâches terminées, le mouvement des projets et les actions d'agents apparaîtront ici comme preuve de progression.",
      edit: "Modifier l'objectif de vie",
      addProject: "Ajouter un projet",
      sectionProjects: "Projets qui font avancer cet objectif",
      noProjects: "Cet objectif n'a pas encore de projet actif. Ajoutez-en un pour le transformer en mouvement concret.",
      addNextTask: "Ajouter la prochaine tâche",
      sectionHealth: "Santé de l'objectif",
      fieldProgress: "Progression",
      fieldCompletedTasks: "Tâches terminées",
      fieldXpBanked: "XP cumulés",
      sectionEvidence: "Preuves récentes",
      noEvidenceLogged: "Aucune preuve n'a encore été enregistrée pour cet objectif. Les tâches terminées, les mises à jour de projet et les actions d'agents apparaîtront ici."
    }
  }
};

export const dictionaries = { en, fr } as const;

type TranslationDictionary = typeof en;
export type TranslationKey = LeafPaths<TranslationDictionary>;
type TranslationParams = Record<string, string | number | null | undefined>;

function resolvePath(dictionary: DictionaryTree, key: string): string | undefined {
  const segments = key.split(".");
  let current: string | DictionaryTree | undefined = dictionary;
  for (const segment of segments) {
    if (!current || typeof current === "string") {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function translate(locale: AppLocale, key: TranslationKey, params?: TranslationParams) {
  const active = resolvePath(dictionaries[locale], key);
  const fallback = resolvePath(dictionaries.en, key);
  const template = active ?? fallback ?? key;
  return interpolate(template, params);
}

type I18nValue = {
  locale: AppLocale;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  formatDate: (value: string | null) => string;
  formatDateTime: (value: string) => string;
  formatNumber: (value: number) => string;
};

const defaultValue: I18nValue = {
  locale: "en",
  t: (key, params) => translate("en", key, params),
  formatDate: (value) => {
    if (!value) {
      return translate("en", "common.labels.noDate");
    }
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric"
    }).format(new Date(`${value}T00:00:00.000Z`));
  },
  formatDateTime: (value) =>
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value)),
  formatNumber: (value) => new Intl.NumberFormat("en").format(value)
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, locale }: { children: ReactNode; locale: AppLocale }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      formatDate: (value) => {
        if (!value) {
          return translate(locale, "common.labels.noDate");
        }

        return new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric"
        }).format(new Date(`${value}T00:00:00.000Z`));
      },
      formatDateTime: (value) =>
        new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(value)),
      formatNumber: (value) => new Intl.NumberFormat(locale).format(value)
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext) ?? defaultValue;
}
