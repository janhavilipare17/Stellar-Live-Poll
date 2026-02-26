import { useState, useEffect, useCallback } from "react";
import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
} from "@stellar/freighter-api";
import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import "./App.css";

//  Config 
const CONTRACT_ID = "CC7IYQYSM76SN7EP3QYPYPKZZ4MST6G6CP4AIIM6TNNMUIZRKIHOQX3I";
const RPC_URL = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC_URL);
const SIM_ACCOUNT = "GBYCOYFAW76NBYB5OPKNUUBZY6LHRI7Z43SBMKXJKHVK35Y6QA2CPMAM";

//  Error Types 
const ERRORS = {
  WALLET_NOT_FOUND: "Wallet not found. Please install Freighter or xBull.",
  WALLET_REJECTED: "Transaction was rejected by the user.",
  INSUFFICIENT_BALANCE: "Insufficient balance to complete this transaction.",
  ALREADY_VOTED: "You have already voted in this poll.",
  NETWORK_ERROR: "Network error. Please check your connection.",
  UNKNOWN: "An unexpected error occurred.",
};

function classifyError(error) {
  const msg = error?.message?.toLowerCase() || "";
  if (msg.includes("not found") || msg.includes("no wallet") || msg.includes("install") || msg.includes("freighter") || msg.includes("xbull"))
    return ERRORS.WALLET_NOT_FOUND;
  if (msg.includes("reject") || msg.includes("declined") || msg.includes("cancel") || msg.includes("user denied"))
    return ERRORS.WALLET_REJECTED;
  if (msg.includes("insufficient") || msg.includes("balance"))
    return ERRORS.INSUFFICIENT_BALANCE;
  if (msg.includes("already voted") || msg.includes("already"))
    return ERRORS.ALREADY_VOTED;
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("connect"))
    return ERRORS.NETWORK_ERROR;
  return ERRORS.UNKNOWN;
}

const STATUS = {
  IDLE: "idle",
  PENDING: "pending",
  SUCCESS: "success",
  ERROR: "error",
};

//  Main App 
function App() {
  const [address, setAddress] = useState("");
  const [walletName, setWalletName] = useState("");
  const [activeWallet, setActiveWallet] = useState("");
  const [txStatus, setTxStatus] = useState(STATUS.IDLE);
  const [statusMsg, setStatusMsg] = useState("");
  const [results, setResults] = useState({ a: 0, b: 0 });
  const [hasVoted, setHasVoted] = useState(false);
  const [votedFor, setVotedFor] = useState(null);
  const [lastLedger, setLastLedger] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  

  //  Fetch Results 
  const fetchResults = useCallback(async () => {
    try {
      const contract = new Contract(CONTRACT_ID);
      const simAccount = address || SIM_ACCOUNT;

      let account;
      try {
        account = await server.getAccount(simAccount);
      } catch (e) {
        console.warn("Sim account not found, skipping fetch");
        return;
      }

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call("get_results"))
        .setTimeout(30)
        .build();

      const simResult = await server.simulateTransaction(tx);

      if (rpc.Api.isSimulationSuccess(simResult)) {
        const resultVal = simResult.result?.retval;
        if (resultVal) {
          const tuple = resultVal.value();
          setResults({
            a: Number(tuple[0].value()),
            b: Number(tuple[1].value()),
          });
        }
      }

      const ledger = await server.getLatestLedger();
      setLastLedger(ledger.sequence);
    } catch (e) {
      console.error("fetchResults:", e);
    }
  }, [address]);

  // Connect Wallet 
  const connectWallet = async (walletType) => {
    setIsLoading(true);
    setTxStatus(STATUS.IDLE);
    setStatusMsg("");
    

    try {
      if (walletType === "freighter") {
        // Error type 1: Wallet not installed
        const connected = await isConnected();
        if (!connected) {
          throw new Error("Freighter not installed. Please install from freighter.app");
        }

        // Error type 2: User rejected access
        const accessResult = await requestAccess();
        if (accessResult.error) throw new Error(accessResult.error);

        const addressResult = await getAddress();
        if (addressResult.error) throw new Error(addressResult.error);
        if (!addressResult.address) throw new Error("No address returned from Freighter");

        setAddress(addressResult.address);
        setWalletName("Freighter");
        setActiveWallet("freighter");

      } else if (walletType === "xbull") {
  // Error type 1: xBull not installed
  if (!window.xBullSDK) {
    throw new Error("xBull not installed. Please install from xbull.app");
  }

  // Error type 2: User rejected
  const response = await window.xBullSDK.connect({
    canRequestPublicKey: true,
    canRequestSign: true,
  });
  if (!response) throw new Error("xBull connection rejected by user");

  // Error type 3: No address returned
  const addr = response.publicKey || await window.xBullSDK.getPublicKey();
  if (!addr) throw new Error("No address returned from xBull");

  setAddress(addr);
  setWalletName("xBull");
  setActiveWallet("xbull");
}

      setStatusMsg("");
      setTxStatus(STATUS.IDLE);

    } catch (e) {
      console.error("connectWallet error:", e);
      setTxStatus(STATUS.ERROR);
      setStatusMsg(classifyError(e));
    } finally {
      setIsLoading(false);
    }
  };

  //  Disconnect Wallet 
  const disconnectWallet = () => {
    setAddress("");
    setWalletName("");
    setActiveWallet("");
    setHasVoted(false);
    setVotedFor(null);
    setTxStatus(STATUS.IDLE);
    setStatusMsg("");
    setTxHash("");
  };

  //  Sign Transaction (handles both wallets) 
  const signTx = async (xdr) => {
    if (activeWallet === "freighter") {
      const result = await signTransaction(xdr, {
        networkPassphrase: Networks.TESTNET,
      });
      if (result.error) throw new Error(result.error);
      return result.signedTxXdr;
    } else if (activeWallet === "xbull") {
      const result = await window.xBullSDK.signXDR(xdr, {
        networkPassphrase: Networks.TESTNET,
      });
      if (!result) throw new Error("xBull signing rejected by user");
      return result;
    }
    throw new Error("No wallet connected");
  };

  //  Vote 
  const vote = async (option) => {
    // Error type 1: Wallet not connected
    if (!address) {
      setTxStatus(STATUS.ERROR);
      setStatusMsg("Connect your wallet first.");
      return;
    }
    // Error type 2: Already voted
    if (hasVoted) {
      setTxStatus(STATUS.ERROR);
      setStatusMsg(ERRORS.ALREADY_VOTED);
      return;
    }

    setTxStatus(STATUS.PENDING);
    setStatusMsg("Building transaction...");
    setTxHash("");

    try {
      const contract = new Contract(CONTRACT_ID);

      // Error type 3: Account not funded
      let account;
      try {
        account = await server.getAccount(address);
      } catch (e) {
        throw new Error("insufficient balance or account not funded on testnet");
      }

      const methodName = option === "A" ? "vote_a" : "vote_b";

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call(methodName))
        .setTimeout(30)
        .build();

      setStatusMsg("Simulating transaction...");
      const preparedTx = await server.prepareTransaction(tx);

      setStatusMsg("Awaiting wallet signature...");
      const signedXdr = await signTx(preparedTx.toXDR());

      setStatusMsg("Submitting to network...");
      const submitted = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
      );

      setTxHash(submitted.hash);

      if (submitted.status === "ERROR") {
        throw new Error("Transaction submission error");
      }

      // Poll for confirmation
      setStatusMsg("Waiting for confirmation...");
      let confirmed = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const result = await server.getTransaction(submitted.hash);
        if (result.status === "SUCCESS") {
          confirmed = true;
          break;
        }
        if (result.status === "FAILED") {
          throw new Error("Transaction failed on chain");
        }
      }

      if (confirmed) {
        setTxStatus(STATUS.SUCCESS);
        setStatusMsg(`Vote for Option ${option} confirmed! 🎉`);
        setHasVoted(true);
        setVotedFor(option);
        await fetchResults();
      } else {
        throw new Error("Transaction timed out");
      }
    } catch (e) {
      console.error("vote error:", e);
      setTxStatus(STATUS.ERROR);
      setStatusMsg(classifyError(e));
    }
  };

  //  Real-time polling
  useEffect(() => {
    fetchResults();
    const interval = setInterval(fetchResults, 5000);
    return () => clearInterval(interval);
  }, [fetchResults]);

  //  Derived stats 
  const total = results.a + results.b;
  const pctA = total === 0 ? 50 : Math.round((results.a / total) * 100);
  const pctB = total === 0 ? 50 : Math.round((results.b / total) * 100);
  const leading = results.a > results.b ? "A" : results.b > results.a ? "B" : null;

  return (
    <div className="app">
      <div className="bg-orb orb1" />
      <div className="bg-orb orb2" />
      <div className="bg-orb orb3" />

      <div className="container">
        {/* Header */}
        <header className="header">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">STELLAR POLL</span>
          </div>
          <div className="header-right">
            {lastLedger && (
              <div className="ledger-badge">
                <span className="pulse-dot" />
                Ledger #{lastLedger}
              </div>
            )}

            {/* Multi-wallet connect buttons */}
            {address ? (
              <div className="wallet-info">
                <span className="wallet-name">{walletName}</span>
                <span className="wallet-addr">
                  {address.slice(0, 4)}...{address.slice(-4)}
                </span>
                <button className="btn-disconnect" onClick={disconnectWallet}>
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="btn-connect"
                  onClick={() => connectWallet("freighter")}
                  disabled={isLoading}
                >
                  {isLoading && activeWallet === "freighter" ? "Connecting..." : "🔷 Freighter"}
                </button>
                <button
                  className="btn-connect"
                  onClick={() => connectWallet("xbull")}
                  disabled={isLoading}
                  style={{ background: "linear-gradient(135deg, #f5c518, #cc9900)", color: "#000" }}
                >
                  {isLoading && activeWallet === "xbull" ? "Connecting..." : "⚡ xBull"}
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Poll Card */}
        <main className="poll-card">
          <div className="poll-title-wrapper">
            <h1 className="poll-question">
              Which consensus mechanism is superior?
            </h1>
            <p className="poll-subtitle">
              Cast your vote on-chain. Results update live every 5 seconds.
            </p>
          </div>

          {/* Vote Buttons */}
          <div className="vote-grid">
            {/* Option A */}
            <div className={`option-card ${votedFor === "A" ? "voted" : ""} ${leading === "A" ? "leading" : ""}`}>
              <div className="option-header">
                <span className="option-label">OPTION A</span>
                {leading === "A" && <span className="leading-badge">LEADING</span>}
                {votedFor === "A" && <span className="your-vote-badge">YOUR VOTE</span>}
              </div>
              <h2 className="option-title">Stellar SCP</h2>
              <p className="option-desc">
                Federated Byzantine Agreement — fast, energy-efficient, and proven in production.
              </p>
              <div className="bar-wrapper">
                <div className="bar bar-a" style={{ width: `${pctA}%` }} />
                <span className="bar-pct">{pctA}%</span>
              </div>
              <div className="vote-count">{results.a} votes</div>
              <button
                className="btn-vote btn-a"
                onClick={() => vote("A")}
                disabled={!address || hasVoted || txStatus === STATUS.PENDING}
              >
                {hasVoted && votedFor === "A" ? "✓ Voted" : "Vote A"}
              </button>
            </div>

            {/* VS Divider */}
            <div className="vs-divider"><span>VS</span></div>

            {/* Option B */}
            <div className={`option-card ${votedFor === "B" ? "voted" : ""} ${leading === "B" ? "leading" : ""}`}>
              <div className="option-header">
                <span className="option-label">OPTION B</span>
                {leading === "B" && <span className="leading-badge">LEADING</span>}
                {votedFor === "B" && <span className="your-vote-badge">YOUR VOTE</span>}
              </div>
              <h2 className="option-title">Ethereum PoS</h2>
              <p className="option-desc">
                Proof of Stake — decentralized, battle-tested, and powering the largest smart contract ecosystem.
              </p>
              <div className="bar-wrapper">
                <div className="bar bar-b" style={{ width: `${pctB}%` }} />
                <span className="bar-pct">{pctB}%</span>
              </div>
              <div className="vote-count">{results.b} votes</div>
              <button
                className="btn-vote btn-b"
                onClick={() => vote("B")}
                disabled={!address || hasVoted || txStatus === STATUS.PENDING}
              >
                {hasVoted && votedFor === "B" ? "✓ Voted" : "Vote B"}
              </button>
            </div>
          </div>

          {/* Total Votes */}
          <div className="total-bar">
            <div className="total-fill-a" style={{ width: `${pctA}%` }} />
            <div className="total-fill-b" style={{ width: `${pctB}%` }} />
          </div>
          <p className="total-label">{total} total votes cast on-chain</p>

          {/* Transaction Status */}
          {(txStatus !== STATUS.IDLE || statusMsg) && (
            <div className={`status-box status-${txStatus}`}>
              <span className="status-icon">
                {txStatus === STATUS.PENDING && "⏳"}
                {txStatus === STATUS.SUCCESS && "✅"}
                {txStatus === STATUS.ERROR && "❌"}
                {txStatus === STATUS.IDLE && "ℹ️"}
              </span>
              <div className="status-content">
                <span className="status-msg">{statusMsg}</span>
                {txHash && (
                  <a
                    className="tx-link"
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Explorer →
                  </a>
                )}
              </div>
              {txStatus === STATUS.PENDING && <div className="spinner" />}
            </div>
          )}

          {!address && (
            <p className="wallet-prompt">
              Connect Freighter or xBull wallet to vote. Your vote is stored on the Stellar testnet.
            </p>
          )}
        </main>

        {/* Footer */}
        <footer className="footer">
          <span>Built on Stellar Testnet</span>
          <span className="dot">·</span>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            View Contract ↗
          </a>
          <span className="dot">·</span>
          <span>Updates every 5s</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
