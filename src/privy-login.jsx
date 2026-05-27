import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useWallets, useCreateWallet, toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

const APP_ID = process.env.PRIVY_APP_ID;
const RPC    = process.env.HELIUS_RPC;

// Bridge — set immediately so callbacks registered before React mounts are preserved
const bridge = { triggerLogin: null, triggerLogout: null, onReady: null, onLogout: null };
window.__privy = bridge;

function notifyReady(sol, user) {
  const payload = {
    address: sol.address,
    email:   user?.email?.address ?? null,
    // Adapt Privy v3 Uint8Array API → legacy Transaction API that app.html expects
    signTransaction: async (legacyTx) => {
      const bytes = legacyTx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const { signedTransaction } = await sol.signTransaction({ transaction: bytes });
      return { serialize: () => signedTransaction };
    },
  };
  if (bridge.onReady) {
    bridge.onReady(payload);
  } else {
    // onReady not set yet — retry until it is (handles auto-reconnect race)
    const t = setInterval(() => {
      if (bridge.onReady) { clearInterval(t); bridge.onReady(payload); }
    }, 100);
  }
}

function PrivyInner() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  // useWallets from /solana returns ConnectedStandardSolanaWallet[] — includes embedded + external
  const { wallets: solWallets } = useWallets();
  const { createWallet } = useCreateWallet();
  // Retry counter — incremented to re-trigger the effect when wallet exists but isn't ready yet
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    bridge.triggerLogin  = login;
    bridge.triggerLogout = logout;
  }, [login, logout]);

  useEffect(() => {
    if (!ready) return;

    if (!authenticated) {
      bridge.onLogout?.();
      return;
    }

    // Find the embedded Privy Solana wallet by matching address from linkedAccounts.
    // This is robust: linkedAccounts is always populated after login, even before
    // the wallet object appears in solWallets.
    const embeddedAccount = user?.linkedAccounts?.find(
      a => a.type === 'wallet' && a.walletClient === 'privy' && a.chainType === 'solana'
    );

    const sol = embeddedAccount
      ? solWallets.find(w => w.address === embeddedAccount.address)
      : solWallets[0];

    console.log('[Privy] solWallets:', solWallets);
    console.log('[Privy] embeddedAccount:', embeddedAccount);
    console.log('[Privy] sol found:', !!sol);

    if (!sol) {
      createWallet()
        .then(() => {
          // wallet just created — solWallets will update and re-trigger this effect
        })
        .catch(err => {
          const msg = err?.message?.toLowerCase() ?? '';
          if (msg.includes('already')) {
            // Wallet exists but not in solWallets yet (timing). Retry after a short delay.
            setTimeout(() => setRetryCount(n => n + 1), 600);
          } else {
            console.error('[Privy] createWallet error:', err);
          }
        });
      return;
    }

    notifyReady(sol, user);
  }, [ready, authenticated, solWallets, user, retryCount]);

  return null;
}

function PrivyApp() {
  const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false });
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'dark',
          accentColor: '#4caf50',
          logo: 'https://upcycle-collective.vercel.app/tuc-logo.png',
          landingHeader: 'The Upcycle Collective',
          loginMessage: 'Enter your email to get your TUC wallet',
        },
        embeddedWallets: {
          solana: { createOnLogin: 'all-users' },
          showWalletUIs: false,
        },
        externalWallets: { solana: { connectors: solanaConnectors } },
        solanaClusters: [{ name: 'mainnet-beta', rpcUrl: RPC }],
      }}
    >
      <PrivyInner />
    </PrivyProvider>
  );
}

const el = document.createElement('div');
el.id = '__privy-root';
document.body.appendChild(el);
createRoot(el).render(<PrivyApp />);
