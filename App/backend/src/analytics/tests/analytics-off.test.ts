import { describe, expect, it, vi } from "vitest";
import { postAnalyticsEvents } from "../analytics-transport.js";

describe("fork analytics", () => {
  it("never sends desktop analytics to the cloud, even with MEMMY_CLOUD_SERVICE set", async () => {
    const fetchImpl = vi.fn();
    await postAnalyticsEvents({
      clientId: "client-1",
      events: [{ eventName: "app_open" }],
      env: { MEMMY_CLOUD_SERVICE: "https://cloud.example" },
      fetchImpl
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
