/* LIBRA — Frontend connected to FastAPI + MySQL */
(() => {
  "use strict";

  const API = "https://libra-backend-m58p.onrender.com/api";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const iso = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmt = value => {
    if (!value) return "—";
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric"
    });
  };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  const initials = name => String(name || "?").split(/\s+/).slice(0, 2)
    .map(x => x[0] || "").join("").toUpperCase();

  let data = {
    books: [], members: [], loans: [],
    rules: {
      loanDays: 14, finePerDay: 5, maxRenewals: 2, stopFine: 200,
      limits: { Student: 3, Standard: 4, Premium: 6 }
    },
    summary: {}
  };
  let circulationTab = new URLSearchParams(location.search).get("tab") || "On loan";

  // API
  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      let message = payload?.detail || payload?.message || `Request failed (${response.status})`;
      if (Array.isArray(message)) message = message.map(x => x.msg || JSON.stringify(x)).join(", ");
      throw new Error(message);
    }
    return payload;
  }

  async function loadAll() {
    const [books, members, loans, rules, summary] = await Promise.all([
      api("/books"), api("/members"), api("/circulation"),
      api("/settings"), api("/dashboard/summary")
    ]);
    data.books = Array.isArray(books) ? books : books?.items || [];
    data.members = Array.isArray(members) ? members : members?.items || [];
    data.loans = (Array.isArray(loans) ? loans : loans?.items || []).map(l => ({
      ...l,
      bookId: Number(l.bookId ?? l.book_id ?? l.book?.id),
      memberId: Number(l.memberId ?? l.member_id ?? l.member?.id),
      id: Number(l.id),
      fine: Number(l.fine || 0),
      fineDue: Number(l.fineDue ?? l.fine_due ?? l.fine ?? 0),
      renewals: Number(l.renewals || 0)
    }));
    data.rules = {
      loanDays: Number(rules?.loanDays ?? 14),
      finePerDay: Number(rules?.finePerDay ?? 5),
      maxRenewals: Number(rules?.maxRenewals ?? 2),
      stopFine: Number(rules?.stopFine ?? 200),
      limits: {
        Student: Number(rules?.limits?.Student ?? 3),
        Standard: Number(rules?.limits?.Standard ?? 4),
        Premium: Number(rules?.limits?.Premium ?? 6)
      }
    };
    data.summary = summary || {};
  }

  // General helpers
  function toast(message) {
    let el = $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.append(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
  }

  function book(id) {
    return data.books.find(x => Number(x.id) === Number(id));
  }
  function member(id) {
    return data.members.find(x => Number(x.id) === Number(id));
  }
  function activeLoans(memberId) {
    return data.loans.filter(l => Number(l.memberId) === Number(memberId) && !l.returned);
  }
  function statusFor(loan) {
    if (loan.returned || loan.returned_at) return "Returned";
    const status = String(loan.status || "").toLowerCase();
    if (status === "overdue") return "Overdue";
    if (status === "returned") return "Returned";
    if (status === "on loan" || status === "on_loan") return "On loan";
    const due = loan.due || loan.due_date;
    return due && String(due).slice(0, 10) < today() ? "Overdue" : "On loan";
  }
  function fineFor(loan) {
    return Number(loan.fineDue ?? loan.fine_due ?? loan.fine ?? 0);
  }
  function bookForLoan(loan) {
    return loan.book && typeof loan.book === "object"
      ? loan.book : book(loan.bookId ?? loan.book_id ?? loan.book?.id);
  }
  function memberForLoan(loan) {
    return loan.member && typeof loan.member === "object"
      ? loan.member : member(loan.memberId ?? loan.member_id ?? loan.member?.id);
  }
  function loanBookId(loan) {
    return Number(loan.bookId ?? loan.book_id ?? loan.book?.id ?? 0);
  }
  async function reloadAndRefresh() {
    await loadAll();
    refreshAll();
    updateSettingsForm();
  }

  // Book covers + descriptions
  // Google Books is tried first; Open Library is the fallback.
  const bookMetadataCache = new Map();

  function placeholderCover(b) {
    const title = String(b?.title || "LIBRA").trim();
    const words = title.split(/\s+/).filter(Boolean);
    const line1 = (words.slice(0, 2).join(" ") || "LIBRA").slice(0, 25);
    const line2 = words.slice(2, 5).join(" ").slice(0, 25);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="360" height="500" viewBox="0 0 360 500">
        <rect width="360" height="500" fill="#e9e5dc"/>
        <rect x="18" y="18" width="324" height="464" rx="5" fill="none" stroke="#b8b0a2" stroke-width="2"/>
        <path d="M42 90H318M42 410H318" stroke="#b8b0a2" stroke-width="1"/>
        <text x="42" y="65" fill="#777064" font-family="Georgia,serif" font-size="15" letter-spacing="4">LIBRA / LIBRARY</text>
        <text x="42" y="225" fill="#39372f" font-family="Georgia,serif" font-size="29">${esc(line1)}</text>
        <text x="42" y="265" fill="#39372f" font-family="Georgia,serif" font-size="24">${esc(line2)}</text>
        <text x="42" y="445" fill="#777064" font-family="Arial,sans-serif" font-size="13">${esc(String(b?.author || "BOOK COVER").slice(0, 34))}</text>
      </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function cover(b) {
    return placeholderCover(b);
  }

  function cleanDescription(value) {
    if (!value) return "";
    if (Array.isArray(value)) value = value.join(" ");
    const template = document.createElement("template");
    template.innerHTML = String(value);
    return (template.content.textContent || "").replace(/\s+/g, " ").trim();
  }

  function titleSimilarity(a, b) {
    const norm = s => String(s || "").toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.85;
    const xs = new Set(x.split(" "));
    const ys = new Set(y.split(" "));
    const intersection = [...xs].filter(t => ys.has(t)).length;
    return intersection / Math.max(xs.size, ys.size);
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return response.json();
  }

  async function lookupGoogleBooks(b) {
    const title = String(b?.title || "").trim();
    const author = String(b?.author || "").trim();
    const isbn = String(b?.isbn || "").replace(/[^0-9Xx]/g, "");
    const queries = [];
    if (isbn) queries.push(`isbn:${isbn}`);
    if (title && author) queries.push(`intitle:${title}+inauthor:${author}`);
    else if (title) queries.push(`intitle:${title}`);

    for (const q of queries) {
      try {
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10`;
        const result = await fetchJson(url);
        const items = result?.items || [];
        if (!items.length) continue;

        const ranked = items.map(item => {
          const info = item.volumeInfo || {};
          const titleScore = titleSimilarity(title, info.title);
          const authors = (info.authors || []).join(" ").toLowerCase();
          const authorScore = !author || !authors
            ? 0.5 : (authors.includes(author.toLowerCase()) ? 1 : 0);
          return { item, score: titleScore * 0.75 + authorScore * 0.25 };
        }).sort((a, b) => b.score - a.score);

        const best = ranked[0]?.item;
        const info = best?.volumeInfo || {};
        const links = info.imageLinks || {};
        let image = links.extraLarge || links.large || links.medium ||
          links.thumbnail || links.smallThumbnail || "";
        if (image) image = image.replace(/^http:/, "https:").replace(/&zoom=\d+/g, "&zoom=2");
        const description = cleanDescription(info.description);
        if (image || description) return { image: image || null, description: description || null };
      } catch (error) {
        console.warn("Google Books lookup failed:", error);
      }
    }
    return null;
  }

  async function lookupOpenLibrary(b) {
    const title = String(b?.title || "").trim();
    const author = String(b?.author || "").trim();
    const isbn = String(b?.isbn || "").replace(/[^0-9Xx]/g, "");

    if (isbn) {
      try {
        const byIsbn = await fetchJson(
          `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`
        );
        const entry = byIsbn?.[`ISBN:${isbn}`];
        const image = entry?.cover?.large || entry?.cover?.medium || entry?.cover?.small;
        const description = cleanDescription(entry?.description?.value || entry?.description);
        if (image || description) return { image: image || null, description: description || null };
      } catch (error) {
        console.warn("Open Library ISBN lookup failed:", error);
      }
    }

    if (!title) return null;
    try {
      const params = new URLSearchParams({
        title, fields: "title,author_name,cover_i,first_sentence,subject",
        limit: "10"
      });
      if (author) params.set("author", author);
      const result = await fetchJson(`https://openlibrary.org/search.json?${params}`);
      const docs = result?.docs || [];
      const ranked = docs.map(doc => ({
        doc,
        score: titleSimilarity(title, doc.title) * 0.8 +
          (!author ? 0.1 : (String((doc.author_name || []).join(" ")).toLowerCase()
            .includes(author.toLowerCase()) ? 0.2 : 0))
      })).sort((a, b) => b.score - a.score);
      const best = ranked.find(x => x.doc.cover_i) || ranked[0];
      const doc = best?.doc;
      const description = cleanDescription(doc?.first_sentence);
      return {
        image: doc?.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false` : null,
        description: description || null
      };
    } catch (error) {
      console.warn("Open Library title lookup failed:", error);
      return null;
    }
  }

  async function findBookMetadata(b) {
    const title = String(b?.title || "").trim();
    const author = String(b?.author || "").trim();
    const isbn = String(b?.isbn || "").trim();
    if (!title && !isbn) return { image: null, description: null };

    const key = `${isbn.toLowerCase()}|${title.toLowerCase()}|${author.toLowerCase()}`;
    if (!bookMetadataCache.has(key)) {
      const task = (async () => {
        const google = await lookupGoogleBooks(b);
        let openLibrary = null;
        if (!google?.image || !google?.description) {
          openLibrary = await lookupOpenLibrary(b);
        }
        return {
          image: google?.image || openLibrary?.image || null,
          description: google?.description || openLibrary?.description || null
        };
      })();
      bookMetadataCache.set(key, task);
    }
    return bookMetadataCache.get(key);
  }

  function setNoCover(img) {
    if (!img.isConnected) return;
    img.onerror = null;
    img.src = img.dataset.placeholder || placeholderCover({
      title: img.dataset.title, author: img.dataset.author
    });
    img.classList.add("book-cover-fallback");
  }

  function hydrateBookCovers(root = document) {
    $$("img[data-book-cover]", root).forEach(img => {
      if (img.dataset.hydrated === "true") return;
      img.dataset.hydrated = "true";
      const info = {
        title: img.dataset.title || "",
        author: img.dataset.author || "",
        isbn: img.dataset.isbn || ""
      };
      const fallback = placeholderCover(info);
      img.dataset.placeholder = fallback;
      img.src = fallback;

      findBookMetadata(info).then(metadata => {
        if (!img.isConnected || !metadata?.image) return;
        const candidate = metadata.image;
        const test = new Image();
        test.onload = () => {
          if (!img.isConnected) return;
          img.onerror = null;
          img.src = candidate;
          img.classList.remove("book-cover-fallback");
        };
        test.onerror = () => setNoCover(img);
        test.src = candidate;
      }).catch(error => {
        console.warn("Book cover hydration failed:", info.title, error);
        setNoCover(img);
      });
    });
  }
  // Book details popup
  function addBookDetailsStyles() {
    if ($("#bookDetailsStyles")) return;
    const style = document.createElement("style");
    style.id = "bookDetailsStyles";
    style.textContent = `
      .book-details-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,20,20,.58);backdrop-filter:blur(6px)}
      .book-details-backdrop[hidden]{display:none}
      .book-details-modal{position:relative;width:min(900px,100%);max-height:90vh;overflow-y:auto;padding:34px;background:var(--surface,#fff);color:var(--text,#252525);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.24)}
      .book-details-close{position:absolute;top:12px;right:18px;width:38px;height:38px;border:0;background:transparent;color:inherit;font-size:30px;cursor:pointer}
      .book-details-layout{display:grid;grid-template-columns:minmax(150px,230px) 1fr;gap:32px;align-items:start}
      .book-details-cover{min-height:260px;display:flex;justify-content:center;align-items:flex-start;background:var(--background,#f2f0eb);border-radius:10px;overflow:hidden}
      .book-details-cover img{width:100%;max-height:340px;object-fit:contain;display:block}
      .book-details-category{color:var(--muted,#777);font-size:11px;letter-spacing:1.7px;text-transform:uppercase}
      .book-details-info h2{margin:10px 38px 6px 0;font-size:clamp(23px,4vw,34px);line-height:1.2}
      .book-details-author{margin:0 0 18px;color:var(--muted,#777)}
      .book-details-description{line-height:1.7;color:var(--muted,#666);white-space:pre-line}
      .book-details-isbn{margin-top:14px;color:var(--muted,#777);font-size:12px}
      .book-details-stats{display:flex;flex-wrap:wrap;gap:26px;margin-top:25px}
      .book-details-stats div{display:grid;gap:4px}
      .book-details-stats strong{font-size:23px}
      .book-details-stats small{color:var(--muted,#777)}
      .book-details-history{margin-top:32px;border-top:1px solid var(--border,#e5e5e5);padding-top:22px}
      .book-history-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}
      .book-history-heading h3{margin:0 0 4px}
      .book-history-heading p,.book-history-heading>span{margin:0;color:var(--muted,#777);font-size:13px}
      .book-history-list{display:grid;gap:11px}
      .book-history-item{display:grid;grid-template-columns:minmax(130px,1fr) minmax(180px,1.4fr) auto;align-items:center;gap:14px;padding:14px;background:var(--background,#f7f6f3);border-radius:10px}
      .book-history-person{display:flex;align-items:center;gap:10px;min-width:0}
      .book-history-person>div{display:grid;gap:3px;min-width:0}
      .book-history-person strong{overflow-wrap:anywhere}
      .book-history-person small,.book-history-dates{color:var(--muted,#777)}
      .book-history-avatar{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:50%;background:var(--surface,#fff);font-size:12px}
      .book-history-dates{display:grid;gap:5px;font-size:12px}
      .book-details-empty{padding:22px;text-align:center;color:var(--muted,#777);background:var(--background,#f7f6f3);border-radius:10px}
      [data-book-details]{cursor:pointer}
      @media(max-width:600px){.book-details-backdrop{padding:10px}.book-details-modal{padding:25px 17px}.book-details-layout{grid-template-columns:105px 1fr;gap:16px}.book-details-cover{min-height:150px}.book-history-item{grid-template-columns:1fr auto}.book-history-dates{grid-column:1/-1}}
    `;
    document.head.append(style);
  }

  function getLocalDescription(b) {
    return cleanDescription(
      b.description || b.about || b.summary || b.synopsis || b.overview || ""
    );
  }

  let detailsRequestId = 0;

  async function findBookDescription(b) {
    const local = getLocalDescription(b);
    if (local) return local;
    const metadata = await findBookMetadata(b);
    return metadata?.description || "No description is available for this book yet.";
  }

  function showBookDetails(bookId) {
    const b = book(bookId);
    if (!b) return;
    addBookDetailsStyles();

    let modal = $("#bookDetailsModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "bookDetailsModal";
      modal.className = "book-details-backdrop";
      modal.hidden = true;
      modal.innerHTML = `
        <section class="book-details-modal" role="dialog" aria-modal="true" aria-labelledby="bookDetailsTitle">
          <button class="book-details-close" type="button" aria-label="Close book details">×</button>
          <div class="book-details-content"></div>
        </section>`;
      document.body.append(modal);
      modal.addEventListener("click", e => {
        if (e.target === modal || e.target.closest(".book-details-close")) modal.hidden = true;
      });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
      });
    }

    const requestId = ++detailsRequestId;
    const history = data.loans.filter(l => loanBookId(l) === Number(b.id))
      .sort((a, b) => new Date(b.borrowed || b.borrowed_at || 0) - new Date(a.borrowed || a.borrowed_at || 0));

    const historyHTML = history.length ? history.map(l => {
      const m = memberForLoan(l);
      const memberName = typeof l.member === "string" ? l.member : (m?.name || "Unknown member");
      const borrowed = l.borrowed || l.borrowed_at;
      const due = l.due || l.due_date;
      const returned = l.returned === true ? (l.returned_at || l.return_date) : (l.returned || l.returned_at);
      const status = statusFor(l);
      return `
        <div class="book-history-item">
          <div class="book-history-person">
            <span class="book-history-avatar">${esc(initials(memberName))}</span>
            <div><strong>${esc(memberName)}</strong><small>${esc(m?.tier || "")}</small></div>
          </div>
          <div class="book-history-dates">
            <span>Borrowed: ${fmt(borrowed)}</span>
            <span>Due date: ${fmt(due)}</span>
            <span>Returned: ${fmt(returned)}</span>
          </div>
          <span class="status ${status === "Returned" ? "status-returned" : status === "Overdue" ? "status-overdue" : "status-loan"}">${esc(status)}</span>
        </div>`;
    }).join("") : `<div class="book-details-empty">No borrowing history has been recorded for this book yet.</div>`;

    const content = $(".book-details-content", modal);
    content.innerHTML = `
      <div class="book-details-layout">
        <div class="book-details-cover">
          <img data-book-cover data-title="${esc(b.title)}" data-author="${esc(b.author || "")}" data-isbn="${esc(b.isbn || "")}" alt="${esc(b.title)} cover">
        </div>
        <div class="book-details-info">
          <span class="book-details-category">${esc(b.category || "Uncategorised")}</span>
          <h2 id="bookDetailsTitle">${esc(b.title)}</h2>
          <p class="book-details-author">by ${esc(b.author || "Unknown author")}</p>
          <p class="book-details-description">${esc(getLocalDescription(b) || "Loading book description…")}</p>
          <p class="book-details-isbn">ISBN: ${esc(b.isbn || "Not provided")}</p>
          <div class="book-details-stats">
            <div><strong>${Number(b.copies || 0)}</strong><small>Total copies</small></div>
            <div><strong>${Number(b.available || 0)}</strong><small>Available</small></div>
            <div><strong>${history.length}</strong><small>Total borrowings</small></div>
          </div>
        </div>
      </div>
      <div class="book-details-history">
        <div class="book-history-heading">
          <div><h3>Borrowing history</h3><p>Every recorded borrowing for this book, newest first</p></div>
          <span>${history.length} records</span>
        </div>
        <div class="book-history-list">${historyHTML}</div>
      </div>`;
    modal.hidden = false;
    hydrateBookCovers(content);

    if (!getLocalDescription(b)) {
      findBookDescription(b).then(description => {
        if (requestId !== detailsRequestId || !modal.isConnected) return;
        const descriptionElement = $(".book-details-description", content);
        if (descriptionElement) descriptionElement.textContent = description;
      }).catch(error => {
        console.warn("Book description lookup failed:", error);
        if (requestId !== detailsRequestId) return;
        const el = $(".book-details-description", content);
        if (el) el.textContent = "Description could not be loaded. Please try again.";
      });
    }
  }

  // Generic form modal
  function showModal(title, subtitle, fields, onSave) {
    let wrap = $("#dynamicModal");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "dynamicModal";
      wrap.className = "modal-backdrop";
      wrap.hidden = true;
      document.body.append(wrap);
    }
    wrap.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true">
        <div class="modal-heading"><h2>${esc(title)}</h2><button class="icon-button" type="button" data-close>×</button></div>
        <p class="modal-subtitle">${esc(subtitle)}</p>
        <form id="dynamicForm">${fields}
          <div class="modal-actions">
            <button type="button" class="btn btn-light" data-close>Cancel</button>
            <button type="submit" class="btn btn-dark">Save</button>
          </div>
        </form>
      </section>`;
    wrap.hidden = false;
    $$("[data-close]", wrap).forEach(button => button.addEventListener("click", () => { wrap.hidden = true; }));
    wrap.onclick = e => { if (e.target === wrap) wrap.hidden = true; };
    $("#dynamicForm", wrap).addEventListener("submit", async e => {
      e.preventDefault();
      const form = e.currentTarget;
      const submitButton = $('button[type="submit"]', form);
      const values = Object.fromEntries(new FormData(form));
      submitButton.disabled = true;
      submitButton.textContent = "Saving…";
      try {
        await onSave(values);
        wrap.hidden = true;
        await reloadAndRefresh();
      } catch (error) {
        toast(error.message || "Something went wrong.");
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Save";
      }
    });
  }

  const input = (label, name, value = "", type = "text", required = true) => `
    <label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;
  const select = (label, name, options, value) => `
    <label>${label}<select name="${name}" required>
      ${options.map(o => `<option value="${esc(o.value ?? o)}" ${(o.value ?? o) == value ? "selected" : ""}>${esc(o.label ?? o)}</option>`).join("")}
    </select></label>`;

  // Issue a book
  function issueModal() {
    const available = data.books.filter(b => Number(b.available) > 0);
    const active = data.members.filter(m => m.active);
    if (!available.length || !active.length) {
      toast("No available books or active members to issue to.");
      return;
    }
    const bookOptions = available.map(b => ({ value: b.id, label: `${b.title} (${b.available} available)` }));
    const memberOptions = active.map(m => ({ value: m.id, label: `${m.name} (${m.tier})` }));
    showModal("Issue a book", "Select a book and registered member.", `
      ${select("Book", "bookId", bookOptions, available[0].id)}
      ${select("Member", "memberId", memberOptions, active[0].id)}`,
      async values => {
        await api("/circulation/issue", {
          method: "POST",
          body: JSON.stringify({ bookId: Number(values.bookId), memberId: Number(values.memberId) })
        });
        toast("Book issued successfully.");
      });
  }

  // Dashboard
  function updateDashboard() {
    const summary = data.summary || {};
    const total = summary.totalBooks ?? data.books.reduce((n, b) => n + Number(b.copies || 0), 0);
    const available = summary.availableCopies ?? data.books.reduce((n, b) => n + Number(b.available || 0), 0);
    const onLoan = summary.onLoan ?? (total - available);
    const overdue = summary.overdueCount ?? data.loans.filter(l => !l.returned && statusFor(l) === "Overdue").length;
    const unpaidFines = summary.unpaidFines ?? data.loans.filter(l => !l.returned).reduce((n, l) => n + fineFor(l), 0);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set("totalBooks", total);
    set("onLoan", onLoan);
    set("overdueCount", overdue);
    set("memberCount", summary.memberCount ?? data.members.length);
    set("unpaidFines", "₹" + Number(unpaidFines).toLocaleString("en-IN"));

    const topList = $("#topBorrowed");
    if (topList) {
      const topBorrowed = summary.topBorrowed?.length ? summary.topBorrowed :
        [...data.books].sort((a, b) => Number(b.loans || 0) - Number(a.loans || 0)).slice(0, 5);
      topList.innerHTML = topBorrowed.slice(0, 5).map((item, i) => {
        const title = item.title || item.book?.title || "Unknown book";
        const author = item.author || item.book?.author || "";
        const isbn = item.isbn || item.book?.isbn || "";
        const matchingBook = book(item.id || item.bookId || item.book_id || item.book?.id) ||
          data.books.find(x => String(x.title).toLowerCase() === String(title).toLowerCase());
        const bookId = matchingBook?.id || "";
        const count = item.loans ?? item.borrowCount ?? item.count ?? 0;
        return `
          <li ${bookId ? `data-book-details="${esc(bookId)}" tabindex="0" role="button"` : ""}>
            <span class="rank">${i + 1}</span>
            <img src="${cover({ title, author })}" data-book-cover data-title="${esc(title)}" data-author="${esc(author)}" data-isbn="${esc(isbn)}" alt="${esc(title)} cover">
            <span class="book-info"><strong>${esc(title)}</strong><small>${esc(author)}</small></span>
            <b>${count}</b>
          </li>`;
      }).join("");
      hydrateBookCovers(topList);
    }

    const activity = $("#activityBody");
    if (activity) {
      const activityRows = summary.activity?.length ? summary.activity :
        [...data.loans].sort((a, b) => b.id - a.id).slice(0, 6);
      activity.innerHTML = activityRows.slice(0, 6).map(l => {
        const isSummaryActivity = typeof l.book === "string";
        const bookTitle = isSummaryActivity ? l.book : (bookForLoan(l)?.title || "Unknown book");
        const b = isSummaryActivity
          ? data.books.find(x => String(x.title).toLowerCase() === String(bookTitle).toLowerCase())
          : (bookForLoan(l) || book(l.bookId));
        const m = isSummaryActivity ? null : memberForLoan(l);
        const category = isSummaryActivity ? (l.category || b?.category || "") : (b?.category || "");
        const memberName = isSummaryActivity
          ? (typeof l.member === "string" ? l.member : "Unknown") : (m?.name || "Unknown");
        const status = l.status || statusFor(l);
        const bookId = b?.id || "";
        return `
          <tr>
            <td><span class="table-book" ${bookId ? `data-book-details="${esc(bookId)}" tabindex="0" role="button"` : ""}>
              ${b ? `<img src="${cover(b)}" data-book-cover data-title="${esc(b.title)}" data-author="${esc(b.author || "")}" data-isbn="${esc(b.isbn || "")}" alt="${esc(b.title)} cover">` : ""}
              <span><strong>${esc(bookTitle)}</strong><small>${esc(category)}</small></span>
            </span></td>
            <td><span class="member-cell"><i>${esc(initials(memberName))}</i>${esc(memberName)}</span></td>
            <td>${fmt(l.borrowed || l.borrowed_at)} → ${fmt(l.due || l.due_date)}</td>
            <td>${fmt(l.returned || l.returned_at)}</td>
            <td><span class="status ${status === "Returned" ? "status-returned" : "status-loan"}">${esc(status)}</span></td>
          </tr>`;
      }).join("");
      hydrateBookCovers(activity);
    }

    const todayLabel = $("#todayLabel");
    if (todayLabel) todayLabel.textContent = new Date().toLocaleDateString("en-IN", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    });
  }

  function bindDashboard() {
    const open = () => issueModal();
    ["openIssue", "heroIssue"].forEach(id => $("#" + id)?.addEventListener("click", open));
    $("#closeIssue")?.addEventListener("click", () => { const modal = $("#issueModal"); if (modal) modal.hidden = true; });
    $("#cancelIssue")?.addEventListener("click", () => { const modal = $("#issueModal"); if (modal) modal.hidden = true; });
    $("#issueModal")?.addEventListener("click", e => { if (e.target.id === "issueModal") e.currentTarget.hidden = true; });
    $("#issueForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const bookId = Number($("#issueBook")?.value);
      const memberId = Number($("#issueMember")?.value);
      try {
        await api("/circulation/issue", { method: "POST", body: JSON.stringify({ bookId, memberId }) });
        $("#issueModal").hidden = true;
        await reloadAndRefresh();
        toast("Book issued successfully.");
      } catch (error) { toast(error.message); }
    });
    $("#viewOverdue")?.addEventListener("click", () => { location.href = "circulation.html?tab=Overdue"; });
    $("#notificationButton")?.addEventListener("click", () => {
      const count = data.loans.filter(l => !l.returned && statusFor(l) === "Overdue").length;
      toast(`${count} overdue loans need follow-up.`);
    });
    $("#profileButton")?.addEventListener("click", () => toast("Signed in as Vinuthna Kotha — Librarian."));
    $("#seeAllActivity")?.addEventListener("click", () => { location.href = "circulation.html"; });
    $$(".day").forEach(day => day.addEventListener("click", () => {
      $$(".day").forEach(x => x.classList.remove("selected"));
      day.classList.add("selected");
      const note = $("#calendarNote");
      if (note) note.textContent = `${day.querySelector("small")?.textContent || ""} ${day.querySelector("strong")?.textContent || ""} — check Circulation for due loans.`;
    }));
    let weekOffset = 0;
    const renderWeek = () => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(12, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
      const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      $$(".day").forEach((el, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const small = $("small", el), strong = $("strong", el);
        if (small) small.textContent = labels[d.getDay()];
        if (strong) strong.textContent = d.getDate();
        el.classList.toggle("selected", iso(d) === today());
        const hasDue = data.loans.some(l => !l.returned && (l.due || l.due_date) === iso(d));
        const dot = $("i", el);
        if (dot) dot.style.visibility = hasDue ? "visible" : "hidden";
      });
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const dueCount = data.loans.filter(l => !l.returned &&
        (l.due || l.due_date) >= iso(start) && (l.due || l.due_date) <= iso(end)).length;
      const note = $("#calendarNote");
      if (note) note.textContent = dueCount
        ? `${dueCount} return${dueCount === 1 ? "" : "s"} due this week.` : "No returns due this week.";
    };
    $("#prevWeek")?.addEventListener("click", () => { weekOffset--; renderWeek(); });
    $("#nextWeek")?.addEventListener("click", () => { weekOffset++; renderWeek(); });
    $("#featuredBook")?.addEventListener("click", () => { location.href = "books.html"; });
    renderWeek();
  }
    // Members
  function renderMembers(query = "") {
    const target = $("#membersTable");
    if (!target) return;
    const q = query.toLowerCase();
    const tier = $("#memberTierFilter")?.value || "All";
    const status = $("#memberStatusFilter")?.value || "All";
    const rows = data.members.filter(m =>
      `${m.name} ${m.email || ""} ${m.phone || ""}`.toLowerCase().includes(q) &&
      (tier === "All" || m.tier === tier) &&
      (status === "All" || (status === "Active" && m.active) || (status === "Suspended" && !m.active))
    );
    target.innerHTML = rows.map(m => `
      <tr>
        <td><span class="member-cell"><i>${esc(initials(m.name))}</i><span><strong>${esc(m.name)}</strong><small>${esc(m.email || "No email added")}</small></span></span></td>
        <td>${esc(m.tier)}</td><td>${activeLoans(m.id).length}</td><td>${fmt(m.joined)}</td>
        <td><span class="status ${m.active ? "status-returned" : "status-overdue"}">${m.active ? "Active" : "Suspended"}</span></td>
        <td class="row-actions">
          <button class="btn btn-light btn-small" data-member-edit="${m.id}">Edit</button>
          <button class="btn btn-light btn-small" data-member-toggle="${m.id}">${m.active ? "Suspend" : "Activate"}</button>
          <button class="btn btn-light btn-small" data-member-delete="${m.id}">Delete</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">No members match your search.</td></tr>`;
    const count = $("#membersCount");
    if (count) count.textContent = `${rows.length} of ${data.members.length} members`;
    const total = $("#membersTotal");
    if (total) total.textContent = data.members.length;
    const active = $("#membersActive");
    if (active) active.textContent = data.members.filter(m => m.active).length;
  }

  function memberModal(existing = null) {
    const m = existing || { name: "", email: "", phone: "", tier: "Student" };
    showModal(existing ? "Edit member" : "Add member",
      "Member details are saved to the library database.", `
      ${input("Full name", "name", m.name)}
      ${input("Email address", "email", m.email || "", "email", false)}
      ${input("Phone number", "phone", m.phone || "", "tel", false)}
      ${select("Membership type", "tier", ["Student", "Standard", "Premium"], m.tier)}`,
      async values => {
        const payload = {
          name: values.name.trim(), email: values.email.trim() || null,
          phone: values.phone.trim() || null, tier: values.tier
        };
        if (existing) {
          await api(`/members/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
          toast("Member details updated.");
        } else {
          await api("/members", { method: "POST", body: JSON.stringify(payload) });
          toast("Member added.");
        }
      });
  }

  function bindMembers() {
    $("#addMember")?.addEventListener("click", () => memberModal());
    $("#memberSearch")?.addEventListener("input", e => renderMembers(e.target.value));
    ["memberTierFilter", "memberStatusFilter"].forEach(id =>
      $("#" + id)?.addEventListener("change", () => renderMembers($("#memberSearch")?.value || "")));
    $("#membersTable")?.addEventListener("click", async e => {
      const edit = e.target.closest("[data-member-edit]");
      const toggle = e.target.closest("[data-member-toggle]");
      const del = e.target.closest("[data-member-delete]");
      if (edit) { memberModal(member(edit.dataset.memberEdit)); return; }
      if (toggle) {
        const m = member(toggle.dataset.memberToggle);
        if (!m) return;
        try {
          const nextStatus = !m.active;
          await api(`/members/${m.id}/status?active=${nextStatus}`, { method: "PATCH" });
          await reloadAndRefresh();
          toast(`${m.name} ${nextStatus ? "activated" : "suspended"}.`);
        } catch (error) { toast(error.message); }
        return;
      }
      if (del) {
        const m = member(del.dataset.memberDelete);
        if (!m || !confirm(`Delete ${m.name}?`)) return;
        try {
          await api(`/members/${m.id}`, { method: "DELETE" });
          await reloadAndRefresh();
          toast("Member deleted.");
        } catch (error) { toast(error.message); }
      }
    });
    renderMembers();
  }

  // Books
  function renderBooks(query = "") {
    const target = $("#booksGrid");
    if (!target) return;
    const q = query.toLowerCase();
    const category = $("#bookCategory")?.value || "All";
    const view = $("#bookView")?.value || "grid";
    const rows = data.books.filter(b =>
      `${b.title} ${b.author} ${b.isbn || ""}`.toLowerCase().includes(q) &&
      (category === "All" || b.category === category)
    );
    target.className = view === "list" ? "books-list" : "books-grid";
    target.innerHTML = rows.map(b => `
      <article class="book-card" data-book-details="${esc(b.id)}" tabindex="0" role="button" aria-label="View details for ${esc(b.title)}">
        <img src="${cover(b)}" data-book-cover data-title="${esc(b.title)}" data-author="${esc(b.author || "")}" data-isbn="${esc(b.isbn || "")}" alt="${esc(b.title)} cover">
        <div class="book-card-copy">
          <strong>${esc(b.title)}</strong><small>${esc(b.author)}</small>
          <span>${esc(b.category || "")} · ${Number(b.available || 0)}/${Number(b.copies || 0)} available</span>
          <div class="row-actions">
            <button class="btn btn-light btn-small" data-book-edit="${esc(b.id)}">Edit</button>
            <button class="btn btn-light btn-small" data-book-delete="${esc(b.id)}">Delete</button>
          </div>
        </div>
      </article>`).join("") || `<p class="empty-cell">No books match your filters.</p>`;
    hydrateBookCovers(target);
    const count = $("#booksCount");
    if (count) count.textContent = `${rows.length} titles · ${rows.reduce((n, b) => n + Number(b.copies || 0), 0)} copies`;
  }

  function bookModal(existing = null) {
    const b = existing || { title: "", author: "", isbn: "", category: "Fiction", copies: 1 };
    showModal(existing ? "Edit book" : "Add book", "Enter the book's catalogue details.", `
      ${input("Book title", "title", b.title)}
      ${input("Author", "author", b.author)}
      ${input("ISBN", "isbn", b.isbn || "", "text", false)}
      ${select("Category", "category", [
        "Fiction", "Fantasy", "Sci-Fi", "Classics", "Non-Fiction",
        "Biography", "Self-Help", "Science", "Technology"
      ], b.category)}
      ${input("Total copies", "copies", b.copies, "number")}`,
      async values => {
        const payload = {
          title: values.title.trim(), author: values.author.trim(),
          isbn: values.isbn.trim() || null, category: values.category,
          copies: Math.max(1, Number(values.copies) || 1)
        };
        if (existing) {
          await api(`/books/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
          toast("Book updated.");
        } else {
          await api("/books", { method: "POST", body: JSON.stringify(payload) });
          toast("Book added.");
        }
      });
  }

  function bindBooks() {
    addBookDetailsStyles();
    $("#addBook")?.addEventListener("click", () => bookModal());
    $("#booksSearch")?.addEventListener("input", e => renderBooks(e.target.value));
    $("#bookCategory")?.addEventListener("change", () => renderBooks($("#booksSearch")?.value || ""));
    $("#bookView")?.addEventListener("change", () => renderBooks($("#booksSearch")?.value || ""));
    $("#booksGrid")?.addEventListener("click", async e => {
      const edit = e.target.closest("[data-book-edit]");
      const del = e.target.closest("[data-book-delete]");
      if (edit) { e.stopPropagation(); bookModal(book(edit.dataset.bookEdit)); return; }
      if (del) {
        e.stopPropagation();
        const b = book(del.dataset.bookDelete);
        if (!b || !confirm(`Delete ${b.title}?`)) return;
        try {
          await api(`/books/${b.id}`, { method: "DELETE" });
          await reloadAndRefresh();
          toast("Book deleted.");
        } catch (error) { toast(error.message); }
      }
    });
    renderBooks();
  }

  // Circulation
  function renderCirculation(query = "") {
    const target = $("#circulationTable");
    if (!target) return;
    const q = query.toLowerCase();
    let rows = data.loans.filter(l => {
      const b = bookForLoan(l), m = memberForLoan(l);
      return `${b?.title || ""} ${m?.name || ""}`.toLowerCase().includes(q);
    });
    if (circulationTab === "On loan") rows = rows.filter(l => !l.returned && statusFor(l) !== "Overdue");
    if (circulationTab === "Overdue") rows = rows.filter(l => !l.returned && statusFor(l) === "Overdue");
    if (circulationTab === "Returned") rows = rows.filter(l => !!l.returned || !!l.returned_at);
    if (circulationTab === "Fines") rows = rows.filter(l => fineFor(l) > 0);

    target.innerHTML = rows.map(l => {
      const b = bookForLoan(l), m = memberForLoan(l);
      const status = statusFor(l), fine = fineFor(l);
      return `
        <tr>
          <td><span class="table-book" ${b?.id ? `data-book-details="${esc(b.id)}" tabindex="0" role="button"` : ""}>
            <img src="${cover(b)}" data-book-cover data-title="${esc(b?.title || "Unknown book")}" data-author="${esc(b?.author || "")}" data-isbn="${esc(b?.isbn || "")}" alt="${esc(b?.title || "Book")} cover">
            <span><strong>${esc(b?.title || "Unknown")}</strong><small>${esc(b?.author || "")}</small></span>
          </span></td>
          <td>${esc(m?.name || "Unknown")}</td>
          <td>${fmt(l.borrowed || l.borrowed_at)}</td><td>${fmt(l.due || l.due_date)}</td>
          <td>${fine ? `₹${fine}` : "—"}</td>
          <td><span class="status ${status === "Returned" ? "status-returned" : status === "Overdue" ? "status-overdue" : "status-loan"}">${esc(status)}</span></td>
          <td class="row-actions">${!l.returned && !l.returned_at ? `
            <button class="btn btn-light btn-small" data-renew="${l.id}" ${status === "Overdue" || l.renewals >= data.rules.maxRenewals ? "disabled" : ""}>Renew</button>
            <button class="btn btn-dark btn-small" data-return="${l.id}">Return${fine ? ` · ₹${fine}` : ""}</button>` : "—"}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="7" class="empty-cell">No records in this section.</td></tr>`;
    hydrateBookCovers(target);

    $$(".view-tabs [data-circulation-tab]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.circulationTab === circulationTab);
      const count = $("b", btn);
      if (count) {
        const tab = btn.dataset.circulationTab;
        const n = data.loans.filter(l => {
          if (tab === "On loan") return !l.returned && !l.returned_at && statusFor(l) !== "Overdue";
          if (tab === "Overdue") return !l.returned && !l.returned_at && statusFor(l) === "Overdue";
          if (tab === "Returned") return !!l.returned || !!l.returned_at;
          return fineFor(l) > 0;
        }).length;
        count.textContent = n;
      }
    });
  }

  function bindCirculation() {
    $("#issueBookButton")?.addEventListener("click", issueModal);
    $("#circulationSearch")?.addEventListener("input", e => renderCirculation(e.target.value));
    $$(".view-tabs [data-circulation-tab]").forEach(btn => btn.addEventListener("click", () => {
      circulationTab = btn.dataset.circulationTab;
      renderCirculation($("#circulationSearch")?.value || "");
    }));
    $("#circulationTable")?.addEventListener("click", async e => {
      const returnButton = e.target.closest("[data-return]");
      const renewButton = e.target.closest("[data-renew]");
      if (returnButton) {
        const id = Number(returnButton.dataset.return);
        const loan = data.loans.find(l => l.id === id);
        if (!loan || loan.returned) return;
        try {
          await api(`/circulation/${id}/return`, { method: "POST" });
          await reloadAndRefresh();
          const fine = fineFor(loan);
          toast(fine ? "Book returned. Late fine recorded." : "Book returned successfully.");
        } catch (error) { toast(error.message); }
        return;
      }
      if (renewButton) {
        const id = Number(renewButton.dataset.renew);
        const loan = data.loans.find(l => l.id === id);
        if (!loan || loan.returned) return;
        try {
          await api(`/circulation/${id}/renew`, { method: "POST" });
          await reloadAndRefresh();
          toast("Loan renewed.");
        } catch (error) { toast(error.message); }
      }
    });
    renderCirculation();
  }

  // Global book click handling
  function bindBookDetailsGlobally() {
    document.addEventListener("click", e => {
      if (e.target.closest("[data-book-edit], [data-book-delete], [data-return], [data-renew]")) return;
      const trigger = e.target.closest("[data-book-details]");
      if (trigger?.dataset.bookDetails) showBookDetails(trigger.dataset.bookDetails);
    });
    document.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const trigger = e.target.closest("[data-book-details]");
      if (!trigger || trigger.tagName === "BUTTON" || e.target.closest("button, a, input, select, textarea")) return;
      e.preventDefault();
      if (trigger.dataset.bookDetails) showBookDetails(trigger.dataset.bookDetails);
    });
  }

  // Settings
  function updateSettingsForm() {
    const form = $("#settingsForm");
    if (!form) return;
    const r = data.rules;
    const fields = {
      loanDays: r.loanDays, finePerDay: r.finePerDay,
      maxRenewals: r.maxRenewals, stopFine: r.stopFine,
      studentLimit: r.limits.Student, standardLimit: r.limits.Standard,
      premiumLimit: r.limits.Premium
    };
    Object.entries(fields).forEach(([name, value]) => {
      const field = $(`[name="${name}"]`, form);
      if (field) field.value = value;
    });
  }

  function bindSettings() {
    const form = $("#settingsForm");
    if (form) form.addEventListener("submit", async e => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const payload = {
        loanDays: Math.max(1, Number(values.loanDays)),
        finePerDay: Math.max(0, Number(values.finePerDay)),
        maxRenewals: Math.max(0, Number(values.maxRenewals)),
        stopFine: Math.max(0, Number(values.stopFine)),
        limits: {
          Student: Math.max(1, Number(values.studentLimit)),
          Standard: Math.max(1, Number(values.standardLimit)),
          Premium: Math.max(1, Number(values.premiumLimit))
        }
      };
      try {
        await api("/settings", { method: "PUT", body: JSON.stringify(payload) });
        await reloadAndRefresh();
        toast("Lending rules saved.");
      } catch (error) { toast(error.message); }
    });
    $("#restoreData")?.addEventListener("click", () => toast("Sample data restore is not available through the API yet."));
    updateSettingsForm();
  }

  // Refresh and global events
  function refreshAll() {
    updateDashboard();
    renderBooks($("#booksSearch")?.value || "");
    renderMembers($("#memberSearch")?.value || "");
    renderCirculation($("#circulationSearch")?.value || "");
  }

  function bindGlobal() {
    $(".notification:not(#notificationButton)")?.addEventListener("click", () =>
      toast("LIBRA notifications: review overdue loans in Circulation."));
    $("#globalSearch")?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const query = e.target.value.trim();
        if (query) location.href = `books.html?q=${encodeURIComponent(query)}`;
      }
    });
  }

  // Startup
  document.addEventListener("DOMContentLoaded", async () => {
    bindGlobal();
    bindDashboard();
    bindBooks();
    bindBookDetailsGlobally();
    bindMembers();
    bindCirculation();
    bindSettings();
    try {
      await loadAll();
      refreshAll();
      updateSettingsForm();
      const query = new URLSearchParams(location.search).get("q");
      if (query) {
        const search = $("#booksSearch");
        if (search) { search.value = query; renderBooks(query); }
      }
    } catch (error) {
      console.error("LIBRA API connection error:", error);
      toast("Could not load library data. Check that the backend is running.");
    }
  });
})();