// client/lib/alerts.ts
//
// SweetAlert2 wrappers used instead of window.alert / window.confirm.
//
//  - Dialogs slide up from the bottom of the screen and slide back down on
//    close (keyframes + theme live in app/globals.css, `.swal-app-*`).
//  - Page scrolling (native + Lenis) is frozen while a dialog is open.
//  - SweetAlert2 is loaded on first use, so it is not in the initial bundle.
//  - All text is passed as plain `text` (never `html`), so file names and
//    server messages cannot inject markup.

import type {
  SweetAlertIcon,
  SweetAlertOptions,
  SweetAlertResult,
} from 'sweetalert2';
import { lockScroll } from '@/lib/smoothScroll';

type SwalModule = typeof import('sweetalert2');
type SwalStatic = SwalModule['default'];

let swalPromise: Promise<SwalStatic> | null = null;
const loadSwal = (): Promise<SwalStatic> => {
  swalPromise ??= import('sweetalert2').then((mod) => mod.default);
  return swalPromise;
};

/** Options this app uses (no input fields), as one plain object type. */
type ModalOptions = Omit<SweetAlertOptions, 'input' | 'inputValidator'>;

const BASE_OPTIONS: ModalOptions = {
  buttonsStyling: false,
  heightAuto: false,
  scrollbarPadding: false, // lockScroll() already compensates for the scrollbar
  backdrop: 'rgba(2, 6, 23, 0.6)', // slate-950 / 60%
  showClass: {
    popup: 'swal-app-in',
    backdrop: 'swal2-backdrop-show',
  },
  hideClass: {
    popup: 'swal-app-out',
    backdrop: 'swal2-backdrop-hide',
  },
};

export type AlertTone = 'danger' | 'primary';

const buttonClass = (tone: AlertTone): string =>
  `swal-app-btn ${tone === 'danger' ? 'swal-app-btn--danger' : 'swal-app-btn--primary'}`;

const SETTLE_TIMEOUT_MS = 900;

/**
 * Shows a modal SweetAlert with the page scroll frozen, and resolves only
 * AFTER its slide-down exit animation has finished. (Swal.fire() resolves as
 * soon as a button is pressed; anything shown straight away would cut the
 * exit animation short, because SweetAlert2 can only show one popup at a time.)
 */
const fireModal = async (options: ModalOptions): Promise<SweetAlertResult> => {
  const Swal = await loadSwal();

  // Held in an object: closures assign it, which plain `let` narrowing cannot see.
  const lock: { release: (() => void) | null } = { release: null };
  let markDestroyed: () => void = () => {};
  const destroyed = new Promise<void>((resolve) => {
    markDestroyed = resolve;
  });

  try {
    const result = await Swal.fire({
      ...BASE_OPTIONS,
      ...options,
      willOpen: () => {
        lock.release = lockScroll();
      },
      // didDestroy (not didClose) also runs when another popup replaces this one.
      didDestroy: () => {
        lock.release?.();
        lock.release = null;
        markDestroyed();
      },
    });
    await Promise.race([
      destroyed,
      new Promise<void>((resolve) => window.setTimeout(resolve, SETTLE_TIMEOUT_MS)),
    ]);
    return result;
  } finally {
    lock.release?.();
    lock.release = null;
  }
};

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: AlertTone;
  icon?: SweetAlertIcon;
}

/** Yes/No dialog. Resolves true only when the user confirms. */
export const confirmDialog = async ({
  title,
  text,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tone = 'primary',
  icon = 'question',
}: ConfirmOptions): Promise<boolean> => {
  const result = await fireModal({
    icon,
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    focusCancel: tone === 'danger', // safest default for destructive actions
    reverseButtons: true,
    customClass: {
      container: 'swal-app-container',
      popup: 'swal-app-popup',
      title: 'swal-app-title',
      htmlContainer: 'swal-app-text',
      actions: 'swal-app-actions',
      confirmButton: buttonClass(tone),
      cancelButton: 'swal-app-btn swal-app-btn--ghost',
    },
  });
  return result.isConfirmed;
};

/** Single-button message dialog (replacement for window.alert). */
export const alertDialog = async (
  title: string,
  text?: string,
  icon: SweetAlertIcon = 'info'
): Promise<void> => {
  await fireModal({
    icon,
    title,
    text,
    confirmButtonText: 'OK',
    customClass: {
      container: 'swal-app-container',
      popup: 'swal-app-popup',
      title: 'swal-app-title',
      htmlContainer: 'swal-app-text',
      actions: 'swal-app-actions',
      confirmButton: buttonClass(icon === 'error' ? 'danger' : 'primary'),
    },
  });
};

export const errorDialog = (title: string, text?: string): Promise<void> =>
  alertDialog(title, text, 'error');

/** Small non-blocking message that slides up from the bottom and leaves by itself. */
export const showToast = async (
  title: string,
  icon: SweetAlertIcon = 'success'
): Promise<void> => {
  const Swal = await loadSwal();
  await Swal.fire({
    toast: true,
    position: 'bottom',
    icon,
    title,
    showConfirmButton: false,
    timer: 3200,
    timerProgressBar: true,
    showClass: { popup: 'swal-app-toast-in' },
    hideClass: { popup: 'swal-app-toast-out' },
    customClass: {
      container: 'swal-app-toast-container',
      popup: 'swal-app-toast',
      title: 'swal-app-toast-title',
    },
  });
};
