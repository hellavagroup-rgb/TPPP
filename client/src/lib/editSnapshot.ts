/**
 * Captures the values an edit form was opened with. Background query refreshes
 * may update surrounding lists, but must not replace a dirty form snapshot.
 */
export function createEditSnapshot<T>(value: T): T {
  return structuredClone(value);
}

export function shouldApplyServerSnapshot<T>(
  openedSnapshot: T | null,
  currentFormValue: T,
  formIsOpen: boolean,
): boolean {
  if (!formIsOpen || openedSnapshot === null) return true;
  return JSON.stringify(openedSnapshot) === JSON.stringify(currentFormValue);
}

export function reconcileServerSnapshot<T>(
  openedSnapshot: T | null,
  currentFormValue: T,
  serverValue: T,
  formIsOpen: boolean,
): { applied: boolean; formValue: T; openedSnapshot: T | null } {
  const isPristine = shouldApplyServerSnapshot(openedSnapshot, currentFormValue, formIsOpen);
  const serverChanged = JSON.stringify(openedSnapshot) !== JSON.stringify(serverValue);
  if (!isPristine || !serverChanged) {
    return { applied: false, formValue: currentFormValue, openedSnapshot };
  }
  const nextSnapshot = createEditSnapshot(serverValue);
  return {
    applied: true,
    formValue: createEditSnapshot(serverValue),
    openedSnapshot: nextSnapshot,
  };
}