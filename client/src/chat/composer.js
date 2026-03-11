/**
 * Chat Composer — spam guard
 *
 * Prevents users from spamming messages while the agent is still processing.
 * Disables the send button and shows a visual "processing" state.
 */

let chatForm = null;
let sendBtn = null;
let chatInput = null;
let isGuarding = false;

function setSendDisabled(disabled) {
  if (!sendBtn) return;
  sendBtn.disabled = disabled;
  sendBtn.classList.toggle('is-sending', disabled);
  if (chatInput) {
    chatInput.setAttribute('aria-busy', String(disabled));
  }
  if (chatForm) {
    chatForm.classList.toggle('is-sending', disabled);
  }
}

export function initSpamGuard() {
  chatForm = document.getElementById('chatForm');
  sendBtn = document.getElementById('sendBtn');
  chatInput = document.getElementById('chatInput');

  if (!chatForm) return;

  // Intercept form submission — block if already sending
  chatForm.addEventListener('submit', (event) => {
    if (isGuarding) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }, { capture: true }); // capture phase to run BEFORE legacy handler

  // Listen for custom events from the legacy app
  document.addEventListener('vistara:message-sending', () => {
    isGuarding = true;
    setSendDisabled(true);
  });

  document.addEventListener('vistara:message-sent', () => {
    isGuarding = false;
    setSendDisabled(false);
  });

  document.addEventListener('vistara:message-error', () => {
    isGuarding = false;
    setSendDisabled(false);
  });

  // Also watch for stream start/end events
  document.addEventListener('vistara:stream-start', () => {
    isGuarding = true;
    setSendDisabled(true);
  });

  document.addEventListener('vistara:stream-end', () => {
    isGuarding = false;
    setSendDisabled(false);
  });
}
