import type { OwnedPreeditStatus } from "@/types";

type OwnedPreeditMutation = () => Promise<OwnedPreeditStatus>;
type OwnedPreeditStatusReader = () => Promise<OwnedPreeditStatus>;
type OwnedPreeditStatusObserver = (status: OwnedPreeditStatus) => void;

export async function observeOwnedPreeditMutation(
  mutate: OwnedPreeditMutation,
  refresh: OwnedPreeditStatusReader,
  observe: OwnedPreeditStatusObserver,
): Promise<OwnedPreeditStatus> {
  try {
    const status = await mutate();
    observe(status);
    return status;
  } catch (error) {
    // Recovery is deliberately detached: the mutation's original failure must
    // remain authoritative even if querying or observing the latest state fails.
    void Promise.resolve()
      .then(refresh)
      .then(observe)
      .catch(() => {});
    throw error;
  }
}
