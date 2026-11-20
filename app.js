
/* LIBRA — Frontend connected to FastAPI + MySQL */
(() => {
  "use strict";

  const API = "http://127.0.0.1:8000/api";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const iso = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const plusDays = (date, days) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    return iso(d);
  };

  const fmt = value =>
    value
      ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short"
        })
      : "—";

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));

  const initials = name =>
    String(name || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map(x => x[0] || "")
      .join("")
      .toUpperCase();

  let data = {
    books: [],
    members: [],
    loans: [],
    rules: {
      loanDays: 14,
      finePerDay: 5,
      maxRenewals: 2,
      stopFine: 200,
      limits: { Student: 3, Standard: 4, Premium: 6 }
    },
    summary: {}
  };

  let circulationTab = new URLSearchParams(location.search).get("tab") || "On loan";

  // --------------------------------------------------
  // API
  // --------------------------------------------------

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const payload = response.status === 204
      ? null
      : await response.json().catch(() => null);

    if (!response.ok) {
      let message = payload?.detail || payload?.message || `Request failed (${response.status})`;

      if (Array.isArray(message)) {
        message = message.map(x => x.msg || JSON.stringify(x)).join(", ");
      }

      throw new Error(message);
    }

    return payload;
  }

  async function loadAll() {
    const [books, members, loans, rules, summary] = await Promise.all([
      api("/books"),
      api("/members"),
      api("/circulation"),
      api("/settings"),
      api("/dashboard/summary")
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

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

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
    return data.loans.filter(l =>
      Number(l.memberId) === Number(memberId) && !l.returned
    );
  }

  function cover(b, size = "S") {
    return b?.isbn
      ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(b.isbn)}-${size}.jpg`
      : "";
  }

  function statusFor(loan) {
    if (loan.returned) return "Returned";

    if (loan.status) {
      const status = String(loan.status).toLowerCase();

      if (status === "overdue") return "Overdue";
      if (status === "returned") return "Returned";
      if (status === "on loan" || status === "on_loan") return "On loan";
    }

    return loan.due && loan.due < today() ? "Overdue" : "On loan";
  }

  function fineFor(loan) {
    if (loan.returned) {
      return Number(loan.fineDue ?? loan.fine ?? 0);
    }

    return Number(loan.fineDue ?? loan.fine ?? 0);
  }

  function bookForLoan(loan) {
    return loan.book || book(loan.bookId);
  }

  function memberForLoan(loan) {
    return loan.member || member(loan.memberId);
  }

  async function reloadAndRefresh() {
    await loadAll();
    refreshAll();
    updateSettingsForm();
  }

  // --------------------------------------------------
  // Dashboard
  // --------------------------------------------------

  function updateDashboard() {
    const summary = data.summary || {};

    const total = summary.totalBooks ??
      data.books.reduce((n, b) => n + Number(b.copies || 0), 0);

    const available = summary.availableCopies ??
      data.books.reduce((n, b) => n + Number(b.available || 0), 0);

    const onLoan = summary.onLoan ?? (total - available);

    const overdue = summary.overdueCount ??
      data.loans.filter(l => !l.returned && statusFor(l) === "Overdue").length;

    const unpaidFines = summary.unpaidFines ??
      data.loans.filter(l => !l.returned).reduce((n, l) => n + fineFor(l), 0);

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set("totalBooks", total);
    set("onLoan", onLoan);
    set("overdueCount", overdue);
    set("memberCount", summary.memberCount ?? data.members.length);
    set("unpaidFines", "₹" + Number(unpaidFines).toLocaleString("en-IN"));

    const topList = $("#topBorrowed");

    if (topList) {
      const topBorrowed = summary.topBorrowed?.length
        ? summary.topBorrowed
        : [...data.books]
            .sort((a, b) => Number(b.loans || 0) - Number(a.loans || 0))
            .slice(0, 5);

      topList.innerHTML = topBorrowed.slice(0, 5).map((b, i) => {
        const title = b.title || b.book?.title || "Unknown book";
        const author = b.author || b.book?.author || "";
        const count = b.loans ?? b.borrowCount ?? b.count ?? 0;

        return `
          <li>
            <span class="rank">${i + 1}</span>
            <img src="${cover(b)}" alt="" onerror="this.style.visibility='hidden'">
            <span class="book-info">
              <strong>${esc(title)}</strong>
              <small>${esc(author)}</small>
            </span>
            <b>${count}</b>
          </li>
        `;
      }).join("");
    }

    const activity = $("#activityBody");

    if (activity) {
      const activityRows = summary.activity?.length
        ? summary.activity
        : [...data.loans].sort((a, b) => b.id - a.id).slice(0, 6);

      activity.innerHTML = activityRows.slice(0, 6).map(l => {
        const b = bookForLoan(l);
        const m = memberForLoan(l);
        const status = statusFor(l);

        return `
          <tr>
            <td>
              <span class="table-book">
                <img src="${cover(b)}" alt="" onerror="this.style.visibility='hidden'">
                <span>
                  <strong>${esc(b?.title || "Unknown book")}</strong>
                  <small>${esc(b?.category || "")}</small>
                </span>
              </span>
            </td>
            <td>
              <span class="member-cell">
                <i>${esc(initials(m?.name))}</i>
                ${esc(m?.name || "Unknown")}
              </span>
            </td>
            <td>${fmt(l.borrowed)} → ${fmt(l.due)}</td>
            <td>${fmt(l.returned)}</td>
            <td>
              <span class="status ${status === "Returned" ? "status-returned" : "status-loan"}">
                ${status}
              </span>
            </td>
          </tr>
        `;
      }).join("");
    }

    const todayLabel = $("#todayLabel");
    if (todayLabel) {
      todayLabel.textContent = new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });
    }
  }

  // --------------------------------------------------
  // Modal
  // --------------------------------------------------

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
        <div class="modal-heading">
          <h2>${esc(title)}</h2>
          <button class="icon-button" type="button" data-close>×</button>
        </div>
        <p class="modal-subtitle">${esc(subtitle)}</p>
        <form id="dynamicForm">
          ${fields}
          <div class="modal-actions">
            <button type="button" class="btn btn-light" data-close>Cancel</button>
            <button type="submit" class="btn btn-dark">Save</button>
          </div>
        </form>
      </section>
    `;

    wrap.hidden = false;

    $$("[data-close]", wrap).forEach(button => {
      button.addEventListener("click", () => wrap.hidden = true);
    });

    wrap.addEventListener("click", e => {
      if (e.target === wrap) wrap.hidden = true;
    });

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
    <label>
      ${label}
      <input
        name="${name}"
        type="${type}"
        value="${esc(value)}"
        ${required ? "required" : ""}
      >
    </label>
  `;

  const select = (label, name, options, value) => `
    <label>
      ${label}
      <select name="${name}" required>
        ${options.map(o => `
          <option value="${esc(o.value ?? o)}"
            ${(o.value ?? o) == value ? "selected" : ""}>
            ${esc(o.label ?? o)}
          </option>
        `).join("")}
      </select>
    </label>
  `;

  // --------------------------------------------------
  // Issue a book
  // --------------------------------------------------

  function issueModal() {
    const available = data.books.filter(b => Number(b.available) > 0);
    const active = data.members.filter(m => m.active);

    if (!available.length || !active.length) {
      toast("No available books or active members to issue to.");
      return;
    }

    const bookOptions = available.map(b => ({
      value: b.id,
      label: `${b.title} (${b.available} available)`
    }));

    const memberOptions = active.map(m => ({
      value: m.id,
      label: `${m.name} (${m.tier})`
    }));

    showModal(
      "Issue a book",
      "Select a book and registered member.",
      `
        ${select("Book", "bookId", bookOptions, available[0].id)}
        ${select("Member", "memberId", memberOptions, active[0].id)}
      `,
      async values => {
        await api("/circulation/issue", {
          method: "POST",
          body: JSON.stringify({
            bookId: Number(values.bookId),
            memberId: Number(values.memberId)
          })
        });

        toast("Book issued successfully.");
      }
    );
  }

  // --------------------------------------------------
  // Dashboard events and calendar
  // --------------------------------------------------

  function bindDashboard() {
    const open = () => issueModal();

    ["openIssue", "heroIssue"].forEach(id => {
      $("#" + id)?.addEventListener("click", open);
    });

    $("#closeIssue")?.addEventListener("click", () => {
      const modal = $("#issueModal");
      if (modal) modal.hidden = true;
    });

    $("#cancelIssue")?.addEventListener("click", () => {
      const modal = $("#issueModal");
      if (modal) modal.hidden = true;
    });

    $("#issueModal")?.addEventListener("click", e => {
      if (e.target.id === "issueModal") e.currentTarget.hidden = true;
    });

    // Legacy issue form, if present in the dashboard HTML.
    $("#issueForm")?.addEventListener("submit", async e => {
      e.preventDefault();

      const bookId = Number($("#issueBook")?.value);
      const memberId = Number($("#issueMember")?.value);

      try {
        await api("/circulation/issue", {
          method: "POST",
          body: JSON.stringify({ bookId, memberId })
        });

        $("#issueModal").hidden = true;
        await reloadAndRefresh();
        toast("Book issued successfully.");
      } catch (error) {
        toast(error.message);
      }
    });

    $("#viewOverdue")?.addEventListener("click", () => {
      location.href = "circulation.html?tab=Overdue";
    });

    $("#notificationButton")?.addEventListener("click", () => {
      const count = data.loans.filter(
        l => !l.returned && statusFor(l) === "Overdue"
      ).length;

      toast(`${count} overdue loans need follow-up.`);
    });

    $("#profileButton")?.addEventListener("click", () => {
      toast("Signed in as Vinuthna Kotha — Librarian.");
    });

    $("#seeAllActivity")?.addEventListener("click", () => {
      location.href = "circulation.html";
    });

    $$(".day").forEach(day => {
      day.addEventListener("click", () => {
        $$(".day").forEach(x => x.classList.remove("selected"));
        day.classList.add("selected");

        const note = $("#calendarNote");

        if (note) {
          note.textContent =
            `${day.querySelector("small")?.textContent || ""} ` +
            `${day.querySelector("strong")?.textContent || ""} — ` +
            "check Circulation for due loans.";
        }
      });
    });

    let weekOffset = 0;

    const renderWeek = () => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(12, 0, 0, 0);

      const dayOfWeek = start.getDay();
      start.setDate(start.getDate() - dayOfWeek + weekOffset * 7);

      const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      $$(".day").forEach((el, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);

        const small = $("small", el);
        const strong = $("strong", el);

        if (small) small.textContent = labels[d.getDay()];
        if (strong) strong.textContent = d.getDate();

        el.classList.toggle("selected", iso(d) === today());

        const hasDue = data.loans.some(
          l => !l.returned && l.due === iso(d)
        );

        const dot = $("i", el);
        if (dot) dot.style.visibility = hasDue ? "visible" : "hidden";
      });

      const end = new Date(start);
      end.setDate(start.getDate() + 6);

      const dueCount = data.loans.filter(
        l => !l.returned && l.due >= iso(start) && l.due <= iso(end)
      ).length;

      const note = $("#calendarNote");

      if (note) {
        note.textContent = dueCount
          ? `${dueCount} return${dueCount === 1 ? "" : "s"} due this week.`
          : "No returns due this week.";
      }
    };

    $("#prevWeek")?.addEventListener("click", () => {
      weekOffset--;
      renderWeek();
    });

    $("#nextWeek")?.addEventListener("click", () => {
      weekOffset++;
      renderWeek();
    });

    $("#featuredBook")?.addEventListener("click", () => {
      location.href = "books.html";
    });

    renderWeek();
  }

  // --------------------------------------------------
  // Members
  // --------------------------------------------------

  function renderMembers(query = "") {
    const target = $("#membersTable");
    if (!target) return;

    const q = query.toLowerCase();
    const tier = $("#memberTierFilter")?.value || "All";
    const status = $("#memberStatusFilter")?.value || "All";

    const rows = data.members.filter(m =>
      `${m.name} ${m.email || ""} ${m.phone || ""}`.toLowerCase().includes(q) &&
      (tier === "All" || m.tier === tier) &&
      (
        status === "All" ||
        (status === "Active" && m.active) ||
        (status === "Suspended" && !m.active)
      )
    );

    target.innerHTML = rows.map(m => `
      <tr>
        <td>
          <span class="member-cell">
            <i>${esc(initials(m.name))}</i>
            <span>
              <strong>${esc(m.name)}</strong>
              <small>${esc(m.email || "No email added")}</small>
            </span>
          </span>
        </td>
        <td>${esc(m.tier)}</td>
        <td>${activeLoans(m.id).length}</td>
        <td>${fmt(m.joined)}</td>
        <td>
          <span class="status ${m.active ? "status-returned" : "status-overdue"}">
            ${m.active ? "Active" : "Suspended"}
          </span>
        </td>
        <td class="row-actions">
          <button class="btn btn-light btn-small" data-member-edit="${m.id}">Edit</button>
          <button class="btn btn-light btn-small" data-member-toggle="${m.id}">
            ${m.active ? "Suspend" : "Activate"}
          </button>
          <button class="btn btn-light btn-small" data-member-delete="${m.id}">Delete</button>
        </td>
      </tr>
    `).join("") || `
      <tr><td colspan="6" class="empty-cell">No members match your search.</td></tr>
    `;

    const count = $("#membersCount");
    if (count) count.textContent = `${rows.length} of ${data.members.length} members`;

    const total = $("#membersTotal");
    if (total) total.textContent = data.members.length;

    const active = $("#membersActive");
    if (active) active.textContent = data.members.filter(m => m.active).length;
  }

  function memberModal(existing = null) {
    const m = existing || {
      name: "",
      email: "",
      phone: "",
      tier: "Student"
    };

    showModal(
      existing ? "Edit member" : "Add member",
      "Member details are saved to the library database.",
      `
        ${input("Full name", "name", m.name)}
        ${input("Email address", "email", m.email || "", "email", false)}
        ${input("Phone number", "phone", m.phone || "", "tel", false)}
        ${select("Membership type", "tier", ["Student", "Standard", "Premium"], m.tier)}
      `,
      async values => {
        const payload = {
          name: values.name.trim(),
          email: values.email.trim() || null,
          phone: values.phone.trim() || null,
          tier: values.tier
        };

        if (existing) {
          await api(`/members/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          });

          toast("Member details updated.");
        } else {
          await api("/members", {
            method: "POST",
            body: JSON.stringify(payload)
          });

          toast("Member added.");
        }
      }
    );
  }

  function bindMembers() {
    $("#addMember")?.addEventListener("click", () => memberModal());

    $("#memberSearch")?.addEventListener("input", e => {
      renderMembers(e.target.value);
    });

    ["memberTierFilter", "memberStatusFilter"].forEach(id => {
      $("#" + id)?.addEventListener("change", () => {
        renderMembers($("#memberSearch")?.value || "");
      });
    });

    $("#membersTable")?.addEventListener("click", async e => {
      const edit = e.target.closest("[data-member-edit]");
      const toggle = e.target.closest("[data-member-toggle]");
      const del = e.target.closest("[data-member-delete]");

      if (edit) {
        memberModal(member(edit.dataset.memberEdit));
        return;
      }

      if (toggle) {
        const m = member(toggle.dataset.memberToggle);
        if (!m) return;

        try {
          const nextStatus = !m.active;

          await api(`/members/${m.id}/status?active=${nextStatus}`, {
            method: "PATCH"
          });

          await reloadAndRefresh();
          toast(`${m.name} ${nextStatus ? "activated" : "suspended"}.`);
        } catch (error) {
          toast(error.message);
        }

        return;
      }

      if (del) {
        const m = member(del.dataset.memberDelete);
        if (!m) return;

        if (!confirm(`Delete ${m.name}?`)) return;

        try {
          await api(`/members/${m.id}`, { method: "DELETE" });
          await reloadAndRefresh();
          toast("Member deleted.");
        } catch (error) {
          toast(error.message);
        }
      }
    });

    renderMembers();
  }

  // --------------------------------------------------
  // Books
  // --------------------------------------------------

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
      <article class="book-card">
        <img
          src="${cover(b, "M")}"
          alt="${esc(b.title)} cover"
          onerror="this.style.visibility='hidden'"
        >
        <div class="book-card-copy">
          <strong>${esc(b.title)}</strong>
          <small>${esc(b.author)}</small>
          <span>${esc(b.category)} · ${b.available}/${b.copies} available</span>
          <div class="row-actions">
            <button class="btn btn-light btn-small" data-book-edit="${b.id}">Edit</button>
            <button class="btn btn-light btn-small" data-book-delete="${b.id}">Delete</button>
          </div>
        </div>
      </article>
    `).join("") || `<p class="empty-cell">No books match your filters.</p>`;

    const count = $("#booksCount");

    if (count) {
      count.textContent =
        `${rows.length} titles · ${rows.reduce((n, b) => n + Number(b.copies || 0), 0)} copies`;
    }
  }

  function bookModal(existing = null) {
    const b = existing || {
      title: "",
      author: "",
      isbn: "",
      category: "Fiction",
      copies: 1
    };

    showModal(
      existing ? "Edit book" : "Add book",
      "Enter the book's catalogue details.",
      `
        ${input("Book title", "title", b.title)}
        ${input("Author", "author", b.author)}
        ${input("ISBN", "isbn", b.isbn || "", "text", false)}
        ${select("Category", "category", [
          "Fiction",
          "Fantasy",
          "Sci-Fi",
          "Classics",
          "Non-Fiction",
          "Biography",
          "Self-Help",
          "Science",
          "Technology"
        ], b.category)}
        ${input("Total copies", "copies", b.copies, "number")}
      `,
      async values => {
        const payload = {
          title: values.title.trim(),
          author: values.author.trim(),
          isbn: values.isbn.trim() || null,
          category: values.category,
          copies: Math.max(1, Number(values.copies) || 1)
        };

        if (existing) {
          await api(`/books/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          });

          toast("Book updated.");
        } else {
          await api("/books", {
            method: "POST",
            body: JSON.stringify(payload)
          });

          toast("Book added.");
        }
      }
    );
  }

  function bindBooks() {
    $("#addBook")?.addEventListener("click", () => bookModal());

    $("#booksSearch")?.addEventListener("input", e => {
      renderBooks(e.target.value);
    });

    $("#bookCategory")?.addEventListener("change", () => {
      renderBooks($("#booksSearch")?.value || "");
    });

    $("#bookView")?.addEventListener("change", () => {
      renderBooks($("#booksSearch")?.value || "");
    });

    $("#booksGrid")?.addEventListener("click", async e => {
      const edit = e.target.closest("[data-book-edit]");
      const del = e.target.closest("[data-book-delete]");

      if (edit) {
        bookModal(book(edit.dataset.bookEdit));
        return;
      }

      if (del) {
        const b = book(del.dataset.bookDelete);
        if (!b) return;

        if (!confirm(`Delete ${b.title}?`)) return;

        try {
          await api(`/books/${b.id}`, { method: "DELETE" });
          await reloadAndRefresh();
          toast("Book deleted.");
        } catch (error) {
          toast(error.message);
        }
      }
    });

    renderBooks();
  }

  // --------------------------------------------------
  // Circulation
  // --------------------------------------------------

  function renderCirculation(query = "") {
    const target = $("#circulationTable");
    if (!target) return;

    const q = query.toLowerCase();

    let rows = data.loans.filter(l => {
      const b = bookForLoan(l);
      const m = memberForLoan(l);

      return `${b?.title || ""} ${m?.name || ""}`
        .toLowerCase()
        .includes(q);
    });

    if (circulationTab === "On loan") {
      rows = rows.filter(l => !l.returned && statusFor(l) !== "Overdue");
    }

    if (circulationTab === "Overdue") {
      rows = rows.filter(l => !l.returned && statusFor(l) === "Overdue");
    }

    if (circulationTab === "Returned") {
      rows = rows.filter(l => !!l.returned);
    }

    if (circulationTab === "Fines") {
      rows = rows.filter(l => fineFor(l) > 0);
    }

    target.innerHTML = rows.map(l => {
      const b = bookForLoan(l);
      const m = memberForLoan(l);
      const status = statusFor(l);
      const fine = fineFor(l);

      return `
        <tr>
          <td>
            <span class="table-book">
              <img src="${cover(b)}" alt="" onerror="this.style.visibility='hidden'">
              <span>
                <strong>${esc(b?.title || "Unknown")}</strong>
                <small>${esc(b?.author || "")}</small>
              </span>
            </span>
          </td>
          <td>${esc(m?.name || "Unknown")}</td>
          <td>${fmt(l.borrowed)}</td>
          <td>${fmt(l.due)}</td>
          <td>${fine ? `₹${fine}` : "—"}</td>
          <td>
            <span class="status ${
              status === "Returned"
                ? "status-returned"
                : status === "Overdue"
                  ? "status-overdue"
                  : "status-loan"
            }">${status}</span>
          </td>
          <td class="row-actions">
            ${
              !l.returned
                ? `
                  <button
                    class="btn btn-light btn-small"
                    data-renew="${l.id}"
                    ${status === "Overdue" || l.renewals >= data.rules.maxRenewals ? "disabled" : ""}
                  >Renew</button>
                  <button class="btn btn-dark btn-small" data-return="${l.id}">
                    Return${fine ? ` · ₹${fine}` : ""}
                  </button>
                `
                : "—"
            }
          </td>
        </tr>
      `;
    }).join("") || `
      <tr><td colspan="7" class="empty-cell">No records in this section.</td></tr>
    `;

    $$(".view-tabs [data-circulation-tab]").forEach(btn => {
      btn.classList.toggle(
        "active",
        btn.dataset.circulationTab === circulationTab
      );

      const count = $("b", btn);

      if (count) {
        const tab = btn.dataset.circulationTab;

        const n = data.loans.filter(l => {
          if (tab === "On loan") {
            return !l.returned && statusFor(l) !== "Overdue";
          }

          if (tab === "Overdue") {
            return !l.returned && statusFor(l) === "Overdue";
          }

          if (tab === "Returned") return !!l.returned;

          return fineFor(l) > 0;
        }).length;

        count.textContent = n;
      }
    });
  }

  function bindCirculation() {
    $("#issueBookButton")?.addEventListener("click", issueModal);

    $("#circulationSearch")?.addEventListener("input", e => {
      renderCirculation(e.target.value);
    });

    $$(".view-tabs [data-circulation-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        circulationTab = btn.dataset.circulationTab;
        renderCirculation($("#circulationSearch")?.value || "");
      });
    });

    $("#circulationTable")?.addEventListener("click", async e => {
      const returnButton = e.target.closest("[data-return]");
      const renewButton = e.target.closest("[data-renew]");

      if (returnButton) {
        const id = Number(returnButton.dataset.return);
        const loan = data.loans.find(l => l.id === id);

        if (!loan || loan.returned) return;

        try {
          await api(`/circulation/${id}/return`, {
            method: "POST"
          });

          await reloadAndRefresh();

          const fine = fineFor(loan);

          toast(
            fine
              ? `Book returned. Late fine recorded.`
              : "Book returned successfully."
          );
        } catch (error) {
          toast(error.message);
        }

        return;
      }

      if (renewButton) {
        const id = Number(renewButton.dataset.renew);
        const loan = data.loans.find(l => l.id === id);

        if (!loan || loan.returned) return;

        try {
          await api(`/circulation/${id}/renew`, {
            method: "POST"
          });

          await reloadAndRefresh();
          toast("Loan renewed.");
        } catch (error) {
          toast(error.message);
        }
      }
    });

    renderCirculation();
  }

  // --------------------------------------------------
  // Settings
  // --------------------------------------------------

  function updateSettingsForm() {
    const form = $("#settingsForm");
    if (!form) return;

    const r = data.rules;

    const fields = {
      loanDays: r.loanDays,
      finePerDay: r.finePerDay,
      maxRenewals: r.maxRenewals,
      stopFine: r.stopFine,
      studentLimit: r.limits.Student,
      standardLimit: r.limits.Standard,
      premiumLimit: r.limits.Premium
    };

    Object.entries(fields).forEach(([name, value]) => {
      const field = $(`[name="${name}"]`, form);
      if (field) field.value = value;
    });
  }

  function bindSettings() {
    const form = $("#settingsForm");

    if (form) {
      form.addEventListener("submit", async e => {
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
          await api("/settings", {
            method: "PUT",
            body: JSON.stringify(payload)
          });

          await reloadAndRefresh();
          toast("Lending rules saved.");
        } catch (error) {
          toast(error.message);
        }
      });
    }

    $("#restoreData")?.addEventListener("click", () => {
      toast("Sample data restore is not available through the API yet.");
    });

    updateSettingsForm();
  }

  // --------------------------------------------------
  // Refresh and global events
  // --------------------------------------------------

  function refreshAll() {
    updateDashboard();
    renderBooks($("#booksSearch")?.value || "");
    renderMembers($("#memberSearch")?.value || "");
    renderCirculation($("#circulationSearch")?.value || "");
  }

  function bindGlobal() {
    $(".notification:not(#notificationButton)")?.addEventListener("click", () => {
      toast("LIBRA notifications: review overdue loans in Circulation.");
    });

    // Search is handled here once, without duplicate listeners.
    $("#globalSearch")?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const query = e.target.value.trim();

        if (query) {
          location.href = `books.html?q=${encodeURIComponent(query)}`;
        }
      }
    });
  }

  // --------------------------------------------------
  // Startup
  // --------------------------------------------------

  document.addEventListener("DOMContentLoaded", async () => {
    bindGlobal();
    bindDashboard();
    bindBooks();
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

        if (search) {
          search.value = query;
          renderBooks(query);
        }
      }
    } catch (error) {
      console.error("LIBRA API connection error:", error);

      toast(
        "Could not load library data. Check that the backend is running."
      );
    }
  });
})();
