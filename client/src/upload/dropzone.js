/**
 * Upload Dropzone — drag-and-drop file upload with visual overlay
 *
 * Listens for drag events on the chat thread area and shows an overlay.
 * On drop, triggers the existing upload flow via the hidden file input.
 */

let dropOverlay = null;
let chatPane = null;
let chatFile = null;
let uploadLoading = null;
let uploadLoadingText = null;
let dragCounter = 0;

/**
 * Show the upload loading indicator.
 * @param {string} filename - name of file being uploaded
 */
export function showUploadLoading(filename = '') {
  if (!uploadLoading) return;
  uploadLoading.classList.remove('hidden');
  if (uploadLoadingText) {
    uploadLoadingText.textContent = filename
      ? `Mengupload "${filename}"...`
      : 'Mengupload dataset...';
  }
}

/**
 * Hide the upload loading indicator.
 * @param {{ success?: boolean, message?: string }} options
 */
export function hideUploadLoading(options = {}) {
  if (!uploadLoading) return;
  if (options.message && uploadLoadingText) {
    uploadLoadingText.textContent = options.message;
    setTimeout(() => {
      uploadLoading.classList.add('hidden');
    }, 1200);
  } else {
    uploadLoading.classList.add('hidden');
  }
}

function showOverlay() {
  if (dropOverlay) {
    dropOverlay.classList.remove('hidden');
  }
}

function hideOverlay() {
  if (dropOverlay) {
    dropOverlay.classList.add('hidden');
  }
}

function handleDragEnter(event) {
  event.preventDefault();
  event.stopPropagation();
  dragCounter += 1;
  if (dragCounter === 1) {
    showOverlay();
  }
}

function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  dragCounter -= 1;
  if (dragCounter <= 0) {
    dragCounter = 0;
    hideOverlay();
  }
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  dragCounter = 0;
  hideOverlay();

  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;

  // Transfer the dropped file to the hidden file input
  // The legacy app listens for 'change' on chatFile
  if (chatFile) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(files[0]);
    chatFile.files = dataTransfer.files;
    chatFile.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function initDropzone() {
  dropOverlay = document.getElementById('uploadDropOverlay');
  chatPane = document.getElementById('chatPane');
  chatFile = document.getElementById('chatFile');
  uploadLoading = document.getElementById('uploadLoading');
  uploadLoadingText = document.getElementById('uploadLoadingText');

  if (!chatPane) return;

  // Attach drag-and-drop listeners to the chat pane
  chatPane.addEventListener('dragenter', handleDragEnter);
  chatPane.addEventListener('dragover', handleDragOver);
  chatPane.addEventListener('dragleave', handleDragLeave);
  chatPane.addEventListener('drop', handleDrop);

  // Also allow dropping on the data gate area
  const dataGate = document.getElementById('dataGate');
  if (dataGate) {
    dataGate.addEventListener('dragenter', handleDragEnter);
    dataGate.addEventListener('dragover', handleDragOver);
    dataGate.addEventListener('dragleave', handleDragLeave);
    dataGate.addEventListener('drop', handleDrop);
  }

  // Hook into the existing uploadDataset flow to show/hide loading
  // We observe the chatFile change event to detect when upload starts
  if (chatFile) {
    chatFile.addEventListener('change', () => {
      const file = chatFile.files?.[0];
      if (file) {
        showUploadLoading(file.name);
      }
    });
  }

  // Listen for custom events from legacy app to hide loading
  document.addEventListener('vistara:upload-complete', (event) => {
    const detail = event.detail || {};
    hideUploadLoading({
      success: detail.success !== false,
      message: detail.message || (detail.success !== false ? 'Upload selesai!' : 'Upload gagal.'),
    });
  });

  document.addEventListener('vistara:upload-error', (event) => {
    const detail = event.detail || {};
    hideUploadLoading({
      success: false,
      message: detail.message || 'Upload gagal.',
    });
  });
}
