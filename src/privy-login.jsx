import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useWallets, useCreateWallet, toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

const APP_ID = 'cmpmoghms001v0cjpxq56w5q7';
const RPC    = 'https://mainnet.helius-rpc.com/?api-key=a353da56-f27a-4a7a-9091-bdc6f8d66f27';

// Bridge: vanilla JS reads/writes this to talk to Privy
const bridge = { triggerLogin: null, triggerLogout: null, onReady: null, onLogout: null };
window.__privy = bridge;

function PrivyInner() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();

  // Expose login/logout to vanilla JS
  useEffect(() => {
    bridge.triggerLogin  = login;
    bridge.triggerLogout = logout;
  }, [login, logout]);

  // When auth state changes, notify vanilla JS
  useEffect(() => {
    if (!ready) return;

    if (!authenticated) {
      bridge.onLogout?.();
      return;
    }

    const sol = wallets.find(w => w.walletClientType === 'privy');
    if (!sol) {
      createWallet().catch(console.error);
      return;
    }

    bridge.onReady?.({
      address: sol.address,
      email:   user?.email?.address ?? null,
      signTransaction: tx => sol.signTransaction(tx),
    });
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
          solana: {
            createOnLogin: 'all-users',
          },
        },
        externalWallets: { solana: { connectors: solanaConnectors } },
        solanaClusters: [{ name: 'mainnet-beta', rpcUrl: RPC }],
      }}
    >
      <PrivyInner />
    </PrivyProvider>
  );
}

// Mount into a hidden div
const el = document.createElement('div');
el.id = '__privy-root';
document.body.appendChild(el);
createRoot(el).render(<PrivyApp />);
