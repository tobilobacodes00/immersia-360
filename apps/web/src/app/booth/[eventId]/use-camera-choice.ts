import { useCallback, useRef, useState } from 'react';
import { applyChoice, readCameraChoice, saveCameraChoice, type CameraChoice } from './camera-choice';

/**
 * The saved camera choice as booth state. `change` and `commit` update the saved value, the state
 * and `read()` together, so a callback that runs after an await (a camera that took a second to
 * open) still sees what the operator changed in the meantime.
 */
export function useCameraChoice() {
  const [choice, setChoice] = useState<CameraChoice>(readCameraChoice);
  const latest = useRef(choice);

  const commit = useCallback((next: CameraChoice) => {
    latest.current = next;
    saveCameraChoice(next);
    setChoice(next);
  }, []);

  /** Apply a change to the latest choice; hands back both sides so the caller can tell what moved. */
  const change = useCallback(
    (patch: Partial<CameraChoice>) => {
      const prev = latest.current;
      const next = applyChoice(prev, patch);
      commit(next);
      return { prev, next };
    },
    [commit],
  );

  const read = useCallback(() => latest.current, []);

  return { choice, change, commit, read };
}
