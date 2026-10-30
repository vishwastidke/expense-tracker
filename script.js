(function () {
  'use strict';

  const STORAGE_KEY = 'minimal_expense_tracker_db';
  const BACKUP_KEY = 'minimal_expense_tracker_db_corrupted_backup';
  const DEFAULT_CURRENCY = '₹';

  // --- Initial Schema Definition ---
  const INITIAL_STATE = {
    version: 1,
    account: {
      initialTotalBudget: 0,
      currency: DEFAULT_CURRENCY,
      updatedAt: new Date().toISOString()
    },
    categories: [],
    expenses: []
  };

  let state = null;

  // --- Storage Subsystem ---
  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state = JSON.parse(JSON.stringify(INITIAL_STATE));
      saveState();
      return;
    }

    try {
      state = JSON.parse(raw);
      if (!state.account || !Array.isArray(state.categories) || !Array.isArray(state.expenses)) {
        throw new Error('Invalid state structure');
      }
    } catch (err) {
      console.error('Storage parse failed. Preserving corrupted data to backup key.', err);
      try {
        localStorage.setItem(BACKUP_KEY, raw);
      } catch (backupErr) {
        console.error('Backup write failed', backupErr);
      }
      state = JSON.parse(JSON.stringify(INITIAL_STATE));
      saveState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        alert('Local storage quota exceeded! Please clear previous browser data.');
      } else {
        console.error('Failed to save state to localStorage', e);
      }
    }
  }

  // --- Formatters ---
  function formatMoney(amount, currency = DEFAULT_CURRENCY) {
    const num = Number(amount) || 0;
    const formatted = Math.abs(num).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return (num < 0 ? `-${currency}` : `${currency}`) + formatted;
  }

  function formatDateTime(isoString) {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { line1: '-', line2: '' };

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const line1 = `${day} ${month}`;

    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? String(hours).padStart(2, '0') : '12';
    const line2 = `${hours}:${minutes} ${ampm}`;

    return { line1, line2 };
  }

  // --- Derived Truth Calculations ---
  function calculateDerivedMetrics() {
    const totalBudget = Number(state.account.initialTotalBudget) || 0;

    let totalSpent = 0;
    const categorySpentMap = {};

    state.categories.forEach(c => {
      categorySpentMap[c.id] = 0;
    });

    state.expenses.forEach(e => {
      const amt = Number(e.amount) || 0;
      totalSpent += amt;
      if (categorySpentMap[e.categoryId] !== undefined) {
        categorySpentMap[e.categoryId] += amt;
      }
    });

    const remainingBalance = totalBudget - totalSpent;
    const totalAllocatedCategories = state.categories.reduce((acc, c) => acc + (Number(c.budget) || 0), 0);
    const categoryExceedsBudget = totalAllocatedCategories > totalBudget;

    return {
      totalBudget,
      totalSpent,
      remainingBalance,
      categorySpentMap,
      categoryExceedsBudget
    };
  }

  // --- DOM Element References ---
  const expenseForm = document.getElementById('expense-form');
  const expenseCatSelect = document.getElementById('expense-category');
  const expenseAmtInput = document.getElementById('expense-amount');
  const expenseNotesInput = document.getElementById('expense-notes');
  const expenseSubmitBtn = document.getElementById('expense-submit-btn');

  const budgetForm = document.getElementById('budget-form');
  const budgetInput = document.getElementById('total-budget-input');
  const budgetSubmitBtn = document.getElementById('budget-submit-btn');
  const budgetWarning = document.getElementById('budget-warning');

  const categoryForm = document.getElementById('category-form');
  const catNameInput = document.getElementById('cat-name');
  const catNameError = document.getElementById('cat-name-error');
  const catBudgetInput = document.getElementById('cat-budget');
  const catNotesInput = document.getElementById('cat-notes');

  const metricTotalBudget = document.getElementById('metric-total-budget');
  const metricTotalSpent = document.getElementById('metric-total-spent');
  const metricRemaining = document.getElementById('metric-remaining');

  const categoryCardsContainer = document.getElementById('category-cards-container');

  // --- Render Functions ---
  function renderDropdown(selectedId = null) {
    expenseCatSelect.innerHTML = '';

    if (state.categories.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Create a category first';
      opt.disabled = true;
      opt.selected = true;
      expenseCatSelect.appendChild(opt);
      expenseCatSelect.disabled = true;
      expenseSubmitBtn.disabled = true;
      return;
    }

    expenseCatSelect.disabled = false;
    expenseSubmitBtn.disabled = false;

    // Check if previous selection exists in valid categories
    const hasMatch = selectedId && state.categories.some(c => c.id === selectedId);

    if (!hasMatch) {
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Select Category';
      defaultOpt.disabled = true;
      defaultOpt.selected = true;
      expenseCatSelect.appendChild(defaultOpt);
    }

    state.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      if (hasMatch && cat.id === selectedId) {
        opt.selected = true;
      }
      expenseCatSelect.appendChild(opt);
    });
  }

  function renderMetrics(metrics) {
    metricTotalBudget.textContent = formatMoney(metrics.totalBudget, state.account.currency);
    metricTotalSpent.textContent = formatMoney(metrics.totalSpent, state.account.currency);
    metricRemaining.textContent = formatMoney(metrics.remainingBalance, state.account.currency);

    if (metrics.remainingBalance < 0) {
      metricRemaining.classList.add('deficit');
    } else {
      metricRemaining.classList.remove('deficit');
    }

    if (metrics.categoryExceedsBudget && metrics.totalBudget > 0) {
      budgetWarning.classList.remove('hidden');
    } else {
      budgetWarning.classList.add('hidden');
    }

    // Set budget form button state
    budgetSubmitBtn.textContent = state.account.initialTotalBudget > 0 ? 'Update' : 'Set Budget';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderCategoryCards(metrics) {
    categoryCardsContainer.innerHTML = '';

    if (state.categories.length === 0) {
      categoryCardsContainer.innerHTML = `
        <div class="category-card" style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 20px;">
          No categories created yet. Define your first envelope in Section 3 above.
        </div>
      `;
      return;
    }

    state.categories.forEach(cat => {
      const spent = metrics.categorySpentMap[cat.id] || 0;
      const budget = Number(cat.budget) || 0;
      const remaining = budget - spent;
      const isDeficit = remaining < 0;

      // Filter expenses for this category, sorted latest first
      const catExpenses = state.expenses
        .filter(e => e.categoryId === cat.id)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const card = document.createElement('article');
      card.className = 'category-card';

      let ledgerRowsHtml = '';
      if (catExpenses.length === 0) {
        ledgerRowsHtml = `
          <tr>
            <td colspan="3" class="empty-ledger-row">No expenses logged yet</td>
          </tr>
        `;
      } else {
        ledgerRowsHtml = catExpenses.map(exp => {
          const dt = formatDateTime(exp.timestamp);
          const noteText = exp.notes ? escapeHtml(exp.notes) : '-';
          const amtText = `-${state.account.currency}${Number(exp.amount).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}`;

          return `
            <tr>
              <td class="col-date">
                <div>${dt.line1}</div>
                <div class="date-sub">${dt.line2}</div>
              </td>
              <td class="col-note">${noteText}</td>
              <td class="col-amt">${amtText}</td>
            </tr>
          `;
        }).join('');
      }

      card.innerHTML = `
        <header class="category-header">
          <div class="category-title-row">
            <span class="category-title">${escapeHtml(cat.name)}</span>
            <span class="category-meta">
              Budget: <span class="bold-val">${formatMoney(budget, state.account.currency)}</span> | 
              Remaining: <span class="${isDeficit ? 'deficit' : 'bold-val'}">${formatMoney(remaining, state.account.currency)}</span>
            </span>
          </div>
          ${cat.notes ? `<div class="category-notes-text">${escapeHtml(cat.notes)}</div>` : ''}
        </header>

        <table class="tx-table" aria-label="Transactions for ${escapeHtml(cat.name)}">
          <thead>
            <tr>
              <th scope="col" style="width: 30%;">Date & Time</th>
              <th scope="col" style="width: 45%;">Note</th>
              <th scope="col" style="width: 25%; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${ledgerRowsHtml}
          </tbody>
        </table>
      `;

      categoryCardsContainer.appendChild(card);
    });
  }

  function renderAll() {
    const metrics = calculateDerivedMetrics();
    renderDropdown(expenseCatSelect.value);
    renderMetrics(metrics);
    renderCategoryCards(metrics);
  }

  // --- Event Listeners ---

  // Section 1: Quick Expense Addition
  expenseForm.addEventListener('submit', function (e) {
    e.preventDefault();

    const catId = expenseCatSelect.value;
    const amountVal = parseFloat(expenseAmtInput.value);
    const notesVal = expenseNotesInput.value.trim();

    if (!catId) {
      alert('Please select a category first.');
      expenseCatSelect.focus();
      return;
    }

    if (isNaN(amountVal) || amountVal <= 0) {
      alert('Please enter a valid expense amount greater than 0.');
      expenseAmtInput.focus();
      return;
    }

    const newExpense = {
      id: `exp_${Date.now()}`,
      categoryId: catId,
      amount: amountVal,
      notes: notesVal,
      timestamp: new Date().toISOString()
    };

    state.expenses.push(newExpense);
    saveState();

    // Reset amount & notes; preserve category dropdown
    expenseAmtInput.value = '';
    expenseNotesInput.value = '';

    renderAll();
  });

  // Section 2: Total Budget Configuration
  budgetForm.addEventListener('submit', function (e) {
    e.preventDefault();

    const val = parseFloat(budgetInput.value);
    if (isNaN(val) || val < 0) {
      alert('Please enter a valid budget amount (min 0).');
      budgetInput.focus();
      return;
    }

    state.account.initialTotalBudget = val;
    state.account.updatedAt = new Date().toISOString();
    saveState();

    renderAll();
  });

  // Section 3: Category Creation Form
  catNameInput.addEventListener('input', function () {
    catNameError.classList.add('hidden');
  });

  categoryForm.addEventListener('submit', function (e) {
    e.preventDefault();

    const name = catNameInput.value.trim();
    const budgetVal = parseFloat(catBudgetInput.value);
    const notes = catNotesInput.value.trim();

    if (!name) {
      catNameInput.focus();
      return;
    }

    // Case-insensitive uniqueness check
    const duplicate = state.categories.some(
      c => c.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      catNameError.classList.remove('hidden');
      catNameInput.focus();
      return;
    }

    if (isNaN(budgetVal) || budgetVal < 0) {
      alert('Please enter a valid allocated budget amount (min 0).');
      catBudgetInput.focus();
      return;
    }

    const newCategory = {
      id: `cat_${Date.now()}`,
      name: name,
      budget: budgetVal,
      notes: notes,
      createdAt: new Date().toISOString()
    };

    state.categories.push(newCategory);
    saveState();

    // Reset form inputs
    catNameInput.value = '';
    catBudgetInput.value = '';
    catNotesInput.value = '';
    catNameError.classList.add('hidden');

    // Re-render and select the newly created category in the Section 1 dropdown
    renderAll();
    expenseCatSelect.value = newCategory.id;
  });

  // --- Initial App Boot ---
  function init() {
    loadState();
    if (state.account.initialTotalBudget > 0) {
      budgetInput.value = state.account.initialTotalBudget;
    }
    renderAll();
  }

  init();
})();
