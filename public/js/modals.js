function openModal(id, options = {}) {
  const modal = document.getElementById(id);
  if (modal) {
    if (options.preselectClientId && id === 'modal-invoice') {
      const clientSelect = modal.querySelector('select[name="client_id"]');
      if (clientSelect) clientSelect.value = options.preselectClientId;
    }
    const activeModals = document.querySelectorAll('.modal-overlay.active');
    if (activeModals.length > 0) {
      modal.style.zIndex = (10000 + activeModals.length * 10).toString();
    } else {
      modal.style.zIndex = '9999';
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
    modal.style.zIndex = '';
    const remainingActive = document.querySelectorAll('.modal-overlay.active');
    if (remainingActive.length === 0) {
      document.body.style.overflow = '';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Delegate clicks on data-modal-target
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modal-target]');
    if (btn) {
      e.preventDefault();
      const targetId = btn.getAttribute('data-modal-target');
      const clientId = btn.getAttribute('data-client-id');
      openModal(targetId, { preselectClientId: clientId });
    }
  });

  // Close when clicking modal backdrop
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      const modalId = e.target.id;
      if (modalId) {
        closeModal(modalId);
      } else {
        e.target.classList.remove('active');
      }
    }
  });

  // Close on Escape key (closes top-most active modal)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
      if (activeModals.length > 0) {
        const topModal = activeModals[activeModals.length - 1];
        closeModal(topModal.id);
      }
    }
  });
});
