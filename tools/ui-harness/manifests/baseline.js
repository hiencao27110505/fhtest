/* Permanent screens every feature run re-shoots for regressions.
   setup = JS evaluated in the page after boot. Add a screen here only if it is
   a lasting surface; feature-specific states go in manifests/<feature>.js. */
module.exports = {
  feature: 'baseline',
  langs: ['vi', 'en'],
  themes: ['sage', 'ocean'],
  shots: [
    { name: 'personal',       setup: `go('personal')` },
    { name: 'home',           setup: `go('home')` },
    { name: 'spending',       setup: `go('spending'); segTo('overview')` },
    { name: 'spending-tx',    setup: `go('spending'); segTo('activity')`, settleMs: 700 },
    { name: 'events',         setup: `go('events')` },
    { name: 'expense-modal',  setup: `go('home'); openExpense()`, settleMs: 600 },
    { name: 'budget-sheet',   setup: `go('spending'); openSheet('sheet-budget')`, settleMs: 600 },
    { name: 'settings',       setup: `go('home'); openSheet('sheet-theme')`, settleMs: 600, themes: ['sage'] }
  ]
};
