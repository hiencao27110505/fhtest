import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { PwaUpdatePrompt } from "#/components/pwa-update-prompt.tsx";
import { isDevelopment } from "#/env.ts";
import Footer from "@/components/demo/Footer";
import Header from "@/components/demo/Header";
import TanStackQueryDevtools from "@/integrations/tanstack-query/devtools";
import StoreDevtools from "@/lib/demo-store-devtools";
import { AppProvider } from "@/providers/app/root-provider";
import { AuthProvider } from "@/providers/auth/root-provider";
import appCss from "@/styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				// `viewport-fit=cover` lets the standalone window paint into the iOS
				// safe areas instead of letterboxing around the notch.
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				title: "TanStack Start Starter",
			},
			// Colors the browser/OS chrome around the installed app. Matches
			// `theme_color` in the manifest.
			{ name: "theme-color", content: "#2E9E6B" },
			// iOS ignores the web manifest's `display`; these are how an installed
			// iOS app gets a standalone window and a readable status bar.
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-status-bar-style", content: "default" },
			{ name: "apple-mobile-web-app-title", content: "Earthy" },
			{ name: "mobile-web-app-capable", content: "yes" },
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{ rel: "manifest", href: "/manifest.webmanifest" },
			// iOS does not read icons from the manifest.
			{ rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
			{ rel: "icon", href: "/icons/icon-192.png", type: "image/png" },
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased wrap-anywhere selection:bg-[rgba(79,184,178,0.24)]">
				<AppProvider>
					<AuthProvider>
						<Header />
						{children}
						<Footer />
						<PwaUpdatePrompt />

						{isDevelopment && (
							<TanStackDevtools
								config={{
									position: "bottom-right",
								}}
								plugins={[
									{
										name: "Tanstack Router",
										render: <TanStackRouterDevtoolsPanel />,
									},
									StoreDevtools,
									TanStackQueryDevtools,
								]}
							/>
						)}
					</AuthProvider>
				</AppProvider>
				<Scripts />
			</body>
		</html>
	);
}
