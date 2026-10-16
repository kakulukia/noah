import { afterEach, describe, expect, mock, test } from "bun:test";
import * as ReactQuery from "@tanstack/react-query";
import { ok } from "neverthrow";

const { QueryClient, QueryObserver } = ReactQuery;

const readyWallet = {
  isInitialized: true,
  isWalletLoaded: true,
  isWalletSuspended: false,
  isBackgroundJobRunning: false,
  staticVtxoPubkey: "wallet-a",
};
let wallet = { ...readyWallet };
let vtxos = [];
const startExit = mock(async () => ok(undefined));
const nativeReads = [];
const read = (name, value) => async () => {
  nativeReads.push(name);
  return ok(value);
};
const useWalletStore = () => wallet;
useWalletStore.getState = () => wallet;

// Capture the actual hook options; exercise their lifecycle with a real QueryObserver.
mock.module("@tanstack/react-query", () => ({
  ...ReactQuery,
  useQuery: (options) => options,
  useMutation: (options) => options,
}));
mock.module("react-native", () => ({ AppState: {} }));
mock.module("gt-react-native", () => ({ useGT: () => (text) => text }));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("../../src/store/walletStore", () => ({ useWalletStore }));
mock.module("../../src/contexts/AlertProvider", () => ({ useAlert: () => ({}) }));
mock.module("../../src/hooks/useMarketData", () => ({ getBlockHeight: async () => ok(100) }));
mock.module("../../src/lib/log", () => ({ default: () => ({ d() {}, i() {} }) }));
mock.module("../../src/lib/walletApi", () => ({ getVtxos: async () => read("getVtxos", vtxos)() }));
const unexpectedAction = () => {
  throw new Error("Reading the overview must not execute exit actions");
};
mock.module("../../src/lib/exitApi", () => ({
  cancelExit: unexpectedAction,
  claimExits: unexpectedAction,
  estimateEmergencyExitFee: unexpectedAction,
  progressExits: unexpectedAction,
  startExitForVtxos: startExit,
  syncExit: unexpectedAction,
  getExitVtxos: read("getExitVtxos", [{ vtxo_id: "exit-a" }]),
  getExitStatus: read("getExitStatus", { state: "Processing" }),
  listClaimable: read("listClaimable", []),
  hasPendingExits: read("hasPendingExits", true),
  pendingExitTotal: read("pendingExitTotal", 1000),
  allClaimableAtHeight: read("allClaimableAtHeight", 110),
}));
const { useExitOverview, useStartVtxoExit } = await import("../../src/hooks/useUnilateralExit");

let client;
function queryOptions() {
  return useExitOverview();
}

afterEach(() => {
  client?.clear();
  nativeReads.length = 0;
  wallet = { ...readyWallet };
  vtxos = [];
  startExit.mockClear();
});

describe("emergency exit dust guard", () => {
  test("rejects a selection containing a sub-dust VTXO before starting an exit", async () => {
    vtxos = [
      { id: "dust", amount: 329, state: "Spendable" },
      { id: "eligible", amount: 10_000, state: "Spendable" },
    ];
    await expect(useStartVtxoExit().mutationFn(["dust", "eligible"])).rejects.toThrow(
      "Available VTXOs changed. Refresh and review the exit again.",
    );
    expect(startExit).not.toHaveBeenCalled();
  });

  test("allows a VTXO exactly at the 330 sat exit dust limit", async () => {
    vtxos = [{ id: "at-limit", amount: 330, state: "Spendable" }];
    await useStartVtxoExit().mutationFn(["at-limit"]);
    expect(startExit).toHaveBeenCalledWith(["at-limit"]);
  });
});

describe("exit overview wallet coordination", () => {
  test("does not read on mount or invalidation during a background job, then resumes", async () => {
    client = new QueryClient();
    wallet.isBackgroundJobRunning = true;
    const observer = new QueryObserver(client, queryOptions());
    const unsubscribe = observer.subscribe(() => {});
    await client.invalidateQueries({ queryKey: ["exit-overview"] });
    expect(nativeReads).toEqual([]);

    wallet.isBackgroundJobRunning = false;
    observer.setOptions(queryOptions());
    expect(nativeReads).toContain("getExitVtxos");
    const result = await observer.refetch();
    expect(result.error).toBeNull();
    expect(result.data.spendableVtxos).toEqual([]);
    expect(nativeReads).toContain("getExitVtxos");
    expect(nativeReads).toContain("getExitStatus");
    expect(nativeReads).toContain("getVtxos");
    expect(startExit).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("blocks explicit refetch through a stale observer when the wallet becomes unavailable", async () => {
    for (const unavailable of [
      { isBackgroundJobRunning: true },
      { isWalletSuspended: true },
      { isWalletLoaded: false },
      { isInitialized: false },
    ]) {
      client = new QueryClient();
      wallet = { ...readyWallet };
      const observer = new QueryObserver(client, queryOptions());
      wallet = { ...readyWallet, ...unavailable };
      const result = await observer.refetch();
      expect(nativeReads).toEqual([]);
      expect(result.isError).toBe(true);
      expect(startExit).not.toHaveBeenCalled();
      client.clear();
    }
  });
});
