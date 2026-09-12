// ============================================
// NOTIFICATIONS — Toast alerts + mobile-style notifications
// ============================================

const Notifications = {
  container: null,
  queue: [],
  lastSignal: {}, // symbol + type -> timestamp to prevent spam

  init() {
    this.container = document.getElementById('toastContainer');
  },

  show(type, title, msg = '') {
    if (!this.container) this.init();
    // Prevent duplicate spamming
    const key = `${title}|${msg}`;
    const now = Date.now();
    if (this.lastSignal[key] && now - this.lastSignal[key] < 3000) return;
    this.lastSignal[key] = now;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div class="toast-title">${title}</div>${msg ? `<div class="toast msg">${msg}</div>` : ''}`;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  alert(title, body) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('alertModal').classList.add('show');
  },

  setupAlerts(sym, event, data) {
    // Non-trade-opening events that the user wants to know about
    switch (event) {
      case 'SWEEP':
        this.show('warn', `${sym}: Liquidity Sweep`, data);
        break;
      case 'BOS':
        this.show('info', `${sym}: Break of Structure`, data);
        break;
      case 'CHOCH':
        this.show('info', `${sym}: Change of Character`, data);
        break;
      case 'DAILY_LOSS':
        this.show('sell', 'Daily loss protection activated', 'Trading halted.');
        break;
      case 'DAILY_TARGET':
        this.show('buy', 'Daily profit lock activated', 'Target reached.');
        break;
    }
  }
};

function closeModal() {
  document.getElementById('alertModal').classList.remove('show');
}
