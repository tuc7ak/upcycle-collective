import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useWallets, useCreateWallet, toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

const APP_ID = 'cmpmoghms001v0cjpxq56w5q7';
const RPC    = 'https://mainnet.helius-rpc.com/?api-key=a353da56-f27a-4a7a-9091-bdc6f8d66f27';

// Bridge — set immediately so callbacks registered before React mounts are preserved
const bridge = { triggerLogin: null, triggerLogout: null, onReady: null, onLogout: null };
window.__privy = bridge;

function notifyReady(sol, user) {
  const payload = {
    address: sol.address,
    email:   user?.email?.address ?? null,
    signTransaction: tx => sol.signTransaction(tx),
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
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();

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

    // useWallets() from the /solana subpath only returns Solana wallets
    const sol = wallets[0];

    if (!sol) {
      // Wallet not yet created — only try once
      createWallet().catch(err => {
        // "already has embedded wallet" = it exists but not loaded yet, ignore
        if (!err?.message?.toLowerCase().includes('already')) {
          console.error('createWallet:', err);
        }
      });
      return;
    }

    notifyReady(sol, user);
  }, [ready, authenticated, wallets, user]);

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
