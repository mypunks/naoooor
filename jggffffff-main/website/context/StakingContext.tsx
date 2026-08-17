"use client";

/**
 * Staking context — additive, separate contract/state from Web3Context.
 * Talks to NFTStakingV2, which supports any number of configured ERC-20
 * reward tokens (mirrors the Burn Lab multi-reward pattern in
 * Web3Context.tsx), each paid per staked NFT per completed 24-hour cycle.
 * Kept in its own file/provider so the existing Web3Context is never
 * touched.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "./Web3Context";
import { OWNER_ADDRESS, WEB3_CONFIG, STAKING_CONTRACT_ADDRESS, ALCHEMY_RPC_URL } from "../config/web3";
import STAKING_ABI from "../abi/NFTStakingV2.json";
import ERC721_MINIMAL_ABI from "../abi/ERC721Minimal.json";
import ERC20_ABI from "../abi/ERC20.json";

export type StakingTxState =
  | "IDLE"
  | "CHECKING_APPROVAL"
  | "APPROVAL_REQUIRED"
  | "CONFIRM_IN_WALLET"
  | "TRANSACTION_PENDING"
  | "STAKE_SUCCESSFUL"
  | "UNSTAKE_SUCCESSFUL"
  | "CLAIM_SUCCESSFUL"
  | "TRANSACTION_FAILED"
  | "TRANSACTION_REJECTED"
  | "WRONG_NETWORK";

export interface StakingRewardToken {
  token: string;
  symbol: string;
  decimals: number;
  rewardPerCycle: bigint;
  active: boolean;
  totalLoaded: bigint;
  totalDistributed: bigint;
  contractBalance: bigint;
}

export interface StakedNftPendingReward {
  token: string;
  symbol: string;
  decimals: number;
  amount: bigint;
}

export interface StakedNftInfo {
  tokenId: string;
  stakedAt: number;
  lastClaimAt: number;
  completedCycles: number;
  pendingRewards: StakedNftPendingReward[];
}

interface StakingContextType {
  stakingConfigured: boolean;
  stakingOwnerAddress: string;
  isStakingOwner: boolean;
  cycleDuration: number;
  rewardTokens: StakingRewardToken[];
  rewardTokensLoading: boolean;
  stakedTokens: StakedNftInfo[];
  stakedLoading: boolean;
  txState: StakingTxState;
  txHash: string | null;
  errorMessage: string | null;
  refreshStakingData: () => Promise<void>;
  checkStakingApproval: (ownerAddress: string) => Promise<boolean>;
  approveStaking: () => Promise<boolean>;
  stakeSelected: (tokenIds: string[]) => Promise<boolean>;
  unstakeSelected: (tokenIds: string[]) => Promise<boolean>;
  claimSelected: (tokenIds: string[]) => Promise<boolean>;
  // Admin — reward token configuration (any number of tokens)
  addRewardTokenAdmin: (token: string, rewardPerCycleRaw: bigint) => Promise<boolean>;
  updateRewardAmountAdmin: (token: string, newRewardPerCycleRaw: bigint) => Promise<boolean>;
  setRewardActiveAdmin: (token: string, active: boolean) => Promise<boolean>;
  fundRewardsAdmin: (token: string, amountRaw: bigint) => Promise<boolean>;
  withdrawRewardsAdmin: (token: string, amountRaw: bigint) => Promise<boolean>;
}

const StakingContext = createContext<StakingContextType | undefined>(undefined);

export const StakingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { account, signer, readErc20Meta } = useWeb3();

  const stakingConfigured = !!STAKING_CONTRACT_ADDRESS;

  const [stakingOwnerAddress, setStakingOwnerAddress] = useState(OWNER_ADDRESS);
  const [cycleDuration, setCycleDuration] = useState(86400);
  const [rewardTokens, setRewardTokens] = useState<StakingRewardToken[]>([]);
  const [rewardTokensLoading, setRewardTokensLoading] = useState(false);
  const [stakedTokens, setStakedTokens] = useState<StakedNftInfo[]>([]);
  const [stakedLoading, setStakedLoading] = useState(false);

  const [txState, setTxState] = useState<StakingTxState>("IDLE");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isStakingOwner =
    !!account && account.toLowerCase() === stakingOwnerAddress.toLowerCase();

  // Read-only staking data goes through Alchemy instead of the raw chain
  // RPC — see the ALCHEMY_RPC_URL comment in config/web3.ts. Staking
  // transactions still go through the connected wallet's own `signer`.
  const getReadProvider = () => new ethers.JsonRpcProvider(ALCHEMY_RPC_URL);

  const getStakingReadContract = useCallback(() => {
    return new ethers.Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI, getReadProvider());
  }, []);

  const getStakingSignerContract = useCallback(async () => {
    if (!signer) throw new Error("Wallet not connected");
    return new ethers.Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI, signer);
  }, [signer]);

  const refreshStakingData = useCallback(async () => {
    if (!stakingConfigured) return;
    setRewardTokensLoading(true);
    setStakedLoading(true);
    try {
      const staking = getStakingReadContract();
      const [ownr, cycle, count] = await Promise.all([
        staking.owner().catch(() => "0x0000000000000000000000000000000000000000"),
        staking.CYCLE_DURATION().catch(() => BigInt(86400)),
        staking.getRewardTokensCount().catch(() => BigInt(0)),
      ]);
      setStakingOwnerAddress(OWNER_ADDRESS);
      setCycleDuration(Number(cycle));

      const total = Number(count);
      const tokens: StakingRewardToken[] = [];
      for (let i = 0; i < total; i++) {
        try {
          const cfg = await staking.getRewardToken(i);
          const tokenAddress: string = cfg.token;
          const [meta, balance] = await Promise.all([
            readErc20Meta(tokenAddress),
            staking.getRewardTokenBalance(tokenAddress).catch(() => BigInt(0)),
          ]);
          tokens.push({
            token: tokenAddress,
            symbol: meta?.symbol || "TOKEN",
            decimals: meta?.decimals ?? 18,
            rewardPerCycle: cfg.rewardPerCycle,
            active: cfg.active,
            totalLoaded: cfg.totalLoaded,
            totalDistributed: cfg.totalDistributed,
            contractBalance: balance,
          });
        } catch (err) {
          console.error("Error reading staking reward index", i, err);
        }
      }
      setRewardTokens(tokens);

      if (account) {
        const tokenIds: bigint[] = await staking.stakedTokensOf(account).catch(() => []);
        const infos: StakedNftInfo[] = await Promise.all(
          tokenIds.map(async (id) => {
            const [info, cycles, pending] = await Promise.all([
              staking.stakeInfo(id),
              staking.completedCycles(id).catch(() => BigInt(0)),
              staking.pendingRewardsAll(id).catch(() => [[], []]),
            ]);
            const [pendingTokens, pendingAmounts]: [string[], bigint[]] = pending;
            const pendingRewards: StakedNftPendingReward[] = pendingTokens.map((t, idx) => {
              const meta = tokens.find((rt) => rt.token.toLowerCase() === t.toLowerCase());
              return {
                token: t,
                symbol: meta?.symbol || "TOKEN",
                decimals: meta?.decimals ?? 18,
                amount: pendingAmounts[idx],
              };
            });
            return {
              tokenId: id.toString(),
              stakedAt: Number(info.stakedAt),
              lastClaimAt: Number(info.lastClaimAt),
              completedCycles: Number(cycles),
              pendingRewards,
            };
          })
        );
        setStakedTokens(infos);
      } else {
        setStakedTokens([]);
      }
    } catch (err) {
      console.error("Error refreshing staking data:", err);
    } finally {
      setRewardTokensLoading(false);
      setStakedLoading(false);
    }
  }, [stakingConfigured, account, getStakingReadContract, readErc20Meta]);

  useEffect(() => {
    if (!stakingConfigured) return;
    refreshStakingData();
    const interval = setInterval(refreshStakingData, 20000);
    return () => clearInterval(interval);
  }, [stakingConfigured, refreshStakingData]);

  const checkStakingApproval = async (ownerAddress: string): Promise<boolean> => {
    try {
      const nft = new ethers.Contract(WEB3_CONFIG.NFT_CONTRACT_ADDRESS, ERC721_MINIMAL_ABI, getReadProvider());
      return await nft.isApprovedForAll(ownerAddress, STAKING_CONTRACT_ADDRESS);
    } catch (err) {
      console.error("Error checking staking NFT approval:", err);
      return false;
    }
  };

  const approveStaking = async (): Promise<boolean> => {
    if (!signer) return false;
    try {
      setTxState("CONFIRM_IN_WALLET");
      const nft = new ethers.Contract(WEB3_CONFIG.NFT_CONTRACT_ADDRESS, ERC721_MINIMAL_ABI, signer);
      const tx = await nft.setApprovalForAll(STAKING_CONTRACT_ADDRESS, true);
      setTxState("TRANSACTION_PENDING");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("IDLE");
      return true;
    } catch (err: any) {
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setTxState("TRANSACTION_REJECTED");
      } else {
        setTxState("TRANSACTION_FAILED");
        setErrorMessage(err.reason || err.message || "Approval failed");
      }
      return false;
    }
  };

  const stakeSelected = async (tokenIds: string[]): Promise<boolean> => {
    if (!account) return false;
    if (!stakingConfigured) {
      setTxState("TRANSACTION_FAILED");
      setErrorMessage("Staking contract address is not configured yet.");
      return false;
    }
    try {
      setTxState("CHECKING_APPROVAL");
      const approved = await checkStakingApproval(account);
      if (!approved) {
        setTxState("APPROVAL_REQUIRED");
        return false;
      }
      setTxState("CONFIRM_IN_WALLET");
      const staking = await getStakingSignerContract();
      const tx = await staking.stake(tokenIds.map((id) => BigInt(id)));
      setTxState("TRANSACTION_PENDING");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("STAKE_SUCCESSFUL");
      await refreshStakingData();
      return true;
    } catch (err: any) {
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setTxState("TRANSACTION_REJECTED");
      } else {
        setTxState("TRANSACTION_FAILED");
        setErrorMessage(err.reason || err.message || "Stake transaction failed");
      }
      return false;
    }
  };

  const unstakeSelected = async (tokenIds: string[]): Promise<boolean> => {
    try {
      setTxState("CONFIRM_IN_WALLET");
      const staking = await getStakingSignerContract();
      const tx = await staking.unstake(tokenIds.map((id) => BigInt(id)));
      setTxState("TRANSACTION_PENDING");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("UNSTAKE_SUCCESSFUL");
      await refreshStakingData();
      return true;
    } catch (err: any) {
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setTxState("TRANSACTION_REJECTED");
      } else {
        setTxState("TRANSACTION_FAILED");
        setErrorMessage(err.reason || err.message || "Unstake transaction failed");
      }
      return false;
    }
  };

  const claimSelected = async (tokenIds: string[]): Promise<boolean> => {
    try {
      setTxState("CONFIRM_IN_WALLET");
      const staking = await getStakingSignerContract();
      const tx = await staking.claimRewards(tokenIds.map((id) => BigInt(id)));
      setTxState("TRANSACTION_PENDING");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("CLAIM_SUCCESSFUL");
      await refreshStakingData();
      return true;
    } catch (err: any) {
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setTxState("TRANSACTION_REJECTED");
      } else {
        setTxState("TRANSACTION_FAILED");
        setErrorMessage(err.reason || err.message || "Claim transaction failed");
      }
      return false;
    }
  };

  const callStakingAdminMethod = async (methodName: string, args: any[]): Promise<boolean> => {
    try {
      setTxState("CONFIRM_IN_WALLET");
      const staking = await getStakingSignerContract();
      const tx = await staking[methodName](...args);
      setTxState("TRANSACTION_PENDING");
      setTxHash(tx.hash);
      await tx.wait();
      setTxState("IDLE");
      await refreshStakingData();
      return true;
    } catch (err: any) {
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setTxState("TRANSACTION_REJECTED");
      } else {
        setTxState("TRANSACTION_FAILED");
        setErrorMessage(err.reason || err.message || "Transaction failed");
      }
      return false;
    }
  };

  const addRewardTokenAdmin = (token: string, rewardPerCycleRaw: bigint) =>
    callStakingAdminMethod("addRewardToken", [token, rewardPerCycleRaw]);

  const updateRewardAmountAdmin = (token: string, newRewardPerCycleRaw: bigint) =>
    callStakingAdminMethod("updateRewardAmount", [token, newRewardPerCycleRaw]);

  const setRewardActiveAdmin = (token: string, active: boolean) =>
    callStakingAdminMethod("setRewardActive", [token, active]);

  const withdrawRewardsAdmin = (token: string, amountRaw: bigint) =>
    callStakingAdminMethod("withdrawRewardToken", [token, amountRaw]);

  const fundRewardsAdmin = async (token: string, amountRaw: bigint): Promise<boolean> => {
    if (!account || !signer) return false;
    try {
      const erc20 = new ethers.Contract(token, ERC20_ABI, signer);
      const allowance: bigint = await erc20.allowance(account, STAKING_CONTRACT_ADDRESS);
      if (allowance < amountRaw) {
        setTxState("CONFIRM_IN_WALLET");
        const approveTx = await erc20.approve(STAKING_CONTRACT_ADDRESS, amountRaw);
        setTxState("TRANSACTION_PENDING");
        await approveTx.wait();
      }
      return await callStakingAdminMethod("fundRewardToken", [token, amountRaw]);
    } catch (err: any) {
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        setTxState("TRANSACTION_REJECTED");
      } else {
        setTxState("TRANSACTION_FAILED");
        setErrorMessage(err.reason || err.message || "Funding reward pool failed");
      }
      return false;
    }
  };

  return (
    <StakingContext.Provider
      value={{
        stakingConfigured,
        stakingOwnerAddress,
        isStakingOwner,
        cycleDuration,
        rewardTokens,
        rewardTokensLoading,
        stakedTokens,
        stakedLoading,
        txState,
        txHash,
        errorMessage,
        refreshStakingData,
        checkStakingApproval,
        approveStaking,
        stakeSelected,
        unstakeSelected,
        claimSelected,
        addRewardTokenAdmin,
        updateRewardAmountAdmin,
        setRewardActiveAdmin,
        fundRewardsAdmin,
        withdrawRewardsAdmin,
      }}
    >
      {children}
    </StakingContext.Provider>
  );
};

export function useStaking(): StakingContextType {
  const ctx = useContext(StakingContext);
  if (!ctx) throw new Error("useStaking must be used within a StakingProvider");
  return ctx;
}
