import { useEffect, useRef, useState } from 'react';

import type { FsmSubscribable, SnapshotOf, UseFsmOptions } from './types.js';
import { useFsmSnapshot } from './use-fsm-snapshot.js';

type MachineCell<TMachine> = Readonly<{
  machine: TMachine;
  generation: number;
}>;

export function useFsm<TMachine extends FsmSubscribable<unknown>>(
  create: () => TMachine,
  options: UseFsmOptions<TMachine> = {},
): Readonly<{ machine: TMachine; snapshot: SnapshotOf<TMachine> }> {
  const createRef = useRef(create);
  const attachRef = useRef(options.attach);
  const teardownRef = useRef(options.teardown);
  const deadMachinesRef = useRef<WeakSet<object> | null>(null);

  if (deadMachinesRef.current === null) {
    deadMachinesRef.current = new WeakSet<object>();
  }

  createRef.current = create;
  attachRef.current = options.attach;
  teardownRef.current = options.teardown;

  const [cell, setCell] = useState<MachineCell<TMachine>>(() => ({
    machine: create(),
    generation: 0,
  }));

  const machine = cell.machine;
  const snapshot = useFsmSnapshot(machine) as SnapshotOf<TMachine>;

  useEffect(() => {
    const deadMachines = deadMachinesRef.current;
    if (deadMachines === null) {
      throw new Error('fsm-react: dead machine registry was not initialized');
    }

    if (deadMachines.has(machine)) {
      const replacementMachine = createRef.current();

      if (deadMachines.has(replacementMachine)) {
        throw new Error(
          'fsm-react: create must return a fresh machine after teardown',
        );
      }

      const replacement: MachineCell<TMachine> = {
        machine: replacementMachine,
        generation: cell.generation + 1,
      };

      setCell((current) =>
        current.machine === machine && deadMachines.has(current.machine)
          ? replacement
          : current,
      );
      return;
    }

    const cleanup = attachRef.current?.(machine);

    return () => {
      const teardown = teardownRef.current;

      if (!teardown) {
        cleanup?.();
        return;
      }

      try {
        cleanup?.();
      } finally {
        deadMachines.add(machine);
        teardown(machine);
      }
    };
  }, [cell.generation, machine]);

  return { machine, snapshot };
}
