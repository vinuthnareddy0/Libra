# LIBRA — Frontend prototype

Built with HTML5, CSS3, vanilla JavaScript and LocalStorage. No framework or package installation is required.

## Run
1. Extract the ZIP.
2. Open `index.html` in a modern browser, or run `python -m http.server 8000` in this folder and visit `http://localhost:8000`.

## Pages
- `index.html` — Admin dashboard
- `books.html` — Search, filter, add, edit and delete books
- `members.html` — 50 seeded Indian member names; search, filter, add, edit, suspend/activate and delete members
- `circulation.html` — Issue, renew and return loans; filter by active, overdue, returned and fines
- `settings.html` — Save lending rules or restore sample data
- `styles.css` — Shared styling
- `app.js` — Shared data, LocalStorage persistence and interactions

## Data
Sample data is stored in browser LocalStorage under `libra.dashboard.v1`. Use Settings → Restore sample library to reset it. This is a frontend prototype; data is local to the browser and is not yet connected to Python/MySQL.
