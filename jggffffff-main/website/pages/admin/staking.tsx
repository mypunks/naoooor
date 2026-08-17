import React, { useState } from "react";
import { ethers } from "ethers";
import { Layout } from "../../components/Layout";
import { AdminNav } from "../../components/Admin/Nav";
import { AdminGuard } from "../../components/Admin/AdminGuard";
import { useWeb3 } from "../../context/Web3Context";
import { useStaking } from "../../context/StakingContext";
import { STAKING_CONTRACT_ADDRESS } from "../../config/web3";

export default function AdminStaking() {
  const { account, readErc20Meta } = useWeb3();
  const {
    stakingConfigured,
    stakingOwnerAddress,
    isStakingOwner,
    cycleDuration,
    rewardTokens,
    rewardTokensLoading,
    txState,
    errorMessage,
    addRewardTokenAdmin,
    updateRewardAmountAdmin,
    setRewardActiveAdmin,
    fundRewardsAdmin,
    withdrawRewardsAdmin,
  } = useStaking();

  // Add reward form
  const [newTokenAddress, setNewTokenAddress] = useState("");
  const [newTokenAmount, setNewTokenAmount] = useState("");
  const [newTokenPreview, setNewTokenPreview] = useState<{ symbol: string; decimals: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Per-reward form state, keyed by token address
  const [updateAmounts, setUpdateAmounts] = useState<Record<string, string>>({});
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [withdrawAmounts, setWithdrawAmounts] = useState<Record<string, string>>({});

  const fmt = (amount: bigint, decimals: number) => {
    const formatted = ethers.formatUnits(amount, decimals);
    return parseFloat(formatted).toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  const previewNewToken = async () => {
    if (!ethers.isAddress(newTokenAddress)) return;
    setPreviewLoading(true);
    const meta = await readErc20Meta(newTokenAddress);
    setNewTokenPreview(meta);
    setPreviewLoading(false);
  };

  const submitAddReward = async () => {
    if (!newTokenPreview || !newTokenAmount) return;
    const raw = ethers.parseUnits(newTokenAmount, newTokenPreview.decimals);
    const ok = await addRewardTokenAdmin(newTokenAddress, raw);
    if (ok) {
      setNewTokenAddress("");
      setNewTokenAmount("");
      setNewTokenPreview(null);
    }
  };

  const submitUpdateAmount = async (token: string, decimals: number) => {
    const value = updateAmounts[token];
    if (!value) return;
    const raw = ethers.parseUnits(value, decimals);
    const ok = await updateRewardAmountAdmin(token, raw);
    if (ok) setUpdateAmounts((prev) => ({ ...prev, [token]: "" }));
  };

  const submitFund = async (token: string, decimals: number) => {
    const value = fundAmounts[token];
    if (!value) return;
    const raw = ethers.parseUnits(value, decimals);
    const ok = await fundRewardsAdmin(token, raw);
    if (ok) setFundAmounts((prev) => ({ ...prev, [token]: "" }));
  };

  const submitWithdraw = async (token: string, decimals: number) => {
    const value = withdrawAmounts[token];
    if (!value) return;
    const raw = ethers.parseUnits(value, decimals);
    const ok = await withdrawRewardsAdmin(token, raw);
    if (ok) setWithdrawAmounts((prev) => ({ ...prev, [token]: "" }));
  };

  const cycleHours = Math.round(cycleDuration / 3600);

  return (
    <Layout>
      <AdminNav />
      <AdminGuard>
        <div className="space-y-6">
          {!stakingConfigured && (
            <div className="p-3 border border-amber-900/50 bg-amber-950/20 text-amber-400 text-xs">
              Staking contract address isn&apos;t configured yet — set
              NEXT_PUBLIC_STAKING_CONTRACT_ADDRESS once NFTStakingV2 has been deployed (see
              /contracts/README.md).
            </div>
          )}

          {stakingConfigured && account && !isStakingOwner && (
            <div className="p-3 border border-red-900/50 bg-red-950/20 text-red-400 text-xs">
              Connected wallet is not the Staking contract owner. Staking owner: {stakingOwnerAddress}
            </div>
          )}

          {/* CONTRACT INFO */}
          <div className="p-6 glass pixel-corners space-y-4">
            <h3 className="text-xs font-bold text-zinc-400 tracking-widest uppercase">STAKING CONTRACT</h3>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-zinc-500">CONTRACT ADDRESS</span>
                <span className="text-white font-mono break-all text-right">
                  {stakingConfigured ? STAKING_CONTRACT_ADDRESS : "NOT DEPLOYED"}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-zinc-500">OWNER / ADMIN</span>
                <span className="text-white font-mono break-all text-right">{stakingOwnerAddress}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-zinc-500">CYCLE LENGTH</span>
                <span className="text-white">{cycleHours || 24} hours</span>
              </div>
            </div>
          </div>

          {/* REWARD TOKENS */}
          <div className="p-6 glass pixel-corners space-y-4">
            <h3 className="text-xs font-bold text-zinc-400 tracking-widest uppercase">REWARD TOKENS</h3>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Configure any number of ERC-20 reward tokens. Each pays its own configured amount per
              staked NFT for every fully completed 24-hour cycle — eligibility and payout math are
              computed entirely on-chain.
            </p>

            {/* Add reward */}
            <div className="p-4 glass pixel-corners space-y-3">
              <p className="text-[10px] text-zinc-500 tracking-widest">ADD REWARD TOKEN</p>
              <input
                type="text"
                placeholder="Reward token contract address (0x...)"
                value={newTokenAddress}
                onChange={(e) => {
                  setNewTokenAddress(e.target.value);
                  setNewTokenPreview(null);
                }}
                onBlur={previewNewToken}
                className="w-full bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:border-neon outline-none"
              />
              {previewLoading && <p className="text-[10px] text-zinc-500 animate-pulse">Reading token…</p>}
              {newTokenPreview && (
                <div className="flex justify-between text-[10px] text-zinc-400 p-2 bg-black/40 border border-white/5 pixel-corners">
                  <span>TOKEN: ${newTokenPreview.symbol}</span>
                  <span>DECIMALS: {newTokenPreview.decimals}</span>
                </div>
              )}
              <input
                type="text"
                placeholder="Reward per NFT per 24h cycle (human-readable, e.g. 10)"
                value={newTokenAmount}
                onChange={(e) => setNewTokenAmount(e.target.value)}
                className="w-full bg-black/40 border border-white/10 p-2.5 text-xs text-white focus:border-neon outline-none"
              />
              <button
                onClick={submitAddReward}
                disabled={!newTokenPreview || !newTokenAmount || !isStakingOwner}
                className="px-6 py-2.5 bg-neon text-black font-bold text-xs pixel-corners disabled:opacity-30"
              >
                SAVE REWARD TOKEN
              </button>
            </div>

            {/* Existing reward cards */}
            {rewardTokensLoading ? (
              <p className="text-xs text-zinc-500 animate-pulse">Loading reward configuration…</p>
            ) : rewardTokens.length === 0 ? (
              <p className="text-xs text-zinc-500">No reward tokens configured yet.</p>
            ) : (
              <div className="space-y-4">
                {rewardTokens.map((r) => (
                  <div key={r.token} className="p-4 glass pixel-corners space-y-3">
                    <div className="flex justify-between items-start flex-wrap gap-2">
                      <div>
                        <p className="font-display text-sm font-bold text-white">${r.symbol}</p>
                        <p className="text-[10px] text-zinc-500 font-mono break-all">{r.token}</p>
                      </div>
                      <span
                        className={`px-2 py-1 text-[10px] font-bold tracking-widest border ${
                          r.active
                            ? "bg-white/[0.04] border-neon/40 text-neon"
                            : "bg-white/[0.04] border-white/15 text-zinc-500"
                        }`}
                      >
                        {r.active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-2 bg-black/40 border border-white/5 pixel-corners">
                        <span className="text-[10px] text-zinc-500 block">REWARD / NFT / 24H</span>
                        <span className="text-xs text-neon font-bold">
                          {fmt(r.rewardPerCycle, r.decimals)} {r.symbol}
                        </span>
                      </div>
                      <div className="p-2 bg-black/40 border border-white/5 pixel-corners">
                        <span className="text-[10px] text-zinc-500 block">CONTRACT BALANCE</span>
                        <span className="text-xs text-white">{fmt(r.contractBalance, r.decimals)} {r.symbol}</span>
                      </div>
                      <div className="p-2 bg-black/40 border border-white/5 pixel-corners">
                        <span className="text-[10px] text-zinc-500 block">TOTAL LOADED</span>
                        <span className="text-xs text-white">{fmt(r.totalLoaded, r.decimals)} {r.symbol}</span>
                      </div>
                      <div className="p-2 bg-black/40 border border-white/5 pixel-corners">
                        <span className="text-[10px] text-zinc-500 block">TOTAL DISTRIBUTED</span>
                        <span className="text-xs text-white">{fmt(r.totalDistributed, r.decimals)} {r.symbol}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        placeholder="New reward / NFT / 24h"
                        value={updateAmounts[r.token] || ""}
                        onChange={(e) => setUpdateAmounts((prev) => ({ ...prev, [r.token]: e.target.value }))}
                        className="flex-1 bg-black/40 border border-white/10 p-2 text-xs text-white focus:border-neon outline-none"
                      />
                      <button
                        onClick={() => submitUpdateAmount(r.token, r.decimals)}
                        disabled={!isStakingOwner}
                        className="px-4 py-2 bg-white/5 border border-white/15 text-white text-[10px] font-bold tracking-widest pixel-corners disabled:opacity-30"
                      >
                        UPDATE
                      </button>
                      <button
                        onClick={() => setRewardActiveAdmin(r.token, !r.active)}
                        disabled={!isStakingOwner}
                        className="px-4 py-2 bg-white/5 border border-white/15 text-white text-[10px] font-bold tracking-widest pixel-corners disabled:opacity-30"
                      >
                        {r.active ? "DISABLE" : "ENABLE"}
                      </button>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        placeholder="Amount to fund"
                        value={fundAmounts[r.token] || ""}
                        onChange={(e) => setFundAmounts((prev) => ({ ...prev, [r.token]: e.target.value }))}
                        className="flex-1 bg-black/40 border border-white/10 p-2 text-xs text-white focus:border-neon outline-none"
                      />
                      <button
                        onClick={() => submitFund(r.token, r.decimals)}
                        disabled={!isStakingOwner}
                        className="px-4 py-2 bg-neon text-black text-[10px] font-bold tracking-widest disabled:opacity-30"
                      >
                        FUND
                      </button>
                    </div>
                    <p className="text-[10px] text-zinc-600 -mt-1">
                      Requires an on-chain ERC20 approval first — handled automatically in one flow above.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        placeholder="Amount to withdraw"
                        value={withdrawAmounts[r.token] || ""}
                        onChange={(e) => setWithdrawAmounts((prev) => ({ ...prev, [r.token]: e.target.value }))}
                        className="flex-1 bg-black/40 border border-white/10 p-2 text-xs text-white focus:border-neon outline-none"
                      />
                      <button
                        onClick={() => submitWithdraw(r.token, r.decimals)}
                        disabled={!isStakingOwner}
                        className="px-4 py-2 bg-red-900/60 border border-red-800 text-red-200 text-[10px] font-bold tracking-widest disabled:opacity-30"
                      >
                        WITHDRAW
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {txState !== "IDLE" && (
            <div className="p-3 text-xs glass pixel-corners text-zinc-400">
              STATUS: {txState}
              {txState === "TRANSACTION_FAILED" && errorMessage ? ` — ${errorMessage}` : ""}
            </div>
          )}
        </div>
      </AdminGuard>
    </Layout>
  );
}
