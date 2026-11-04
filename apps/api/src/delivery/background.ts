import { schedule } from 'node-cron';
import type { DeliveryService } from './service';

export function startDeliveryWorker(
  service: DeliveryService,
  log: (message: string, error: unknown) => void = (message, error) =>
    console.error(message, error),
): () => void {
  const run = (): void => {
    void service.runPending().catch((error: unknown) => {
      log('Could not process queued deliveries.', error);
    });
  };
  run();
  const task = schedule('*/5 * * * * *', run);
  return () => task.stop();
}

export function startDigestScheduler(
  service: DeliveryService,
  log: (message: string, error: unknown) => void = (message, error) =>
    console.error(message, error),
): () => void {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await service.scheduleDigests();
      await service.runPending();
    } catch (error) {
      log('Could not enqueue scheduled digests.', error);
    } finally {
      running = false;
    }
  };
  void run();
  const task = schedule('* * * * *', () => void run());
  return () => task.stop();
}
