/** Electron preload 暴露的受限导航接口；普通浏览器没有此对象。 */
type NavigationState = { canGoBack: boolean; canGoForward: boolean };
type DesktopNavigationBridge = {
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  getNavigationState: () => Promise<NavigationState>;
  onNavigationStateChange: (callback: (state: NavigationState) => void) => () => void;
};

const desktop = (window as Window & { desktop?: DesktopNavigationBridge }).desktop;

if (desktop && document.documentElement.hasAttribute('data-desktop')) {
  const navigation = desktop;
  let backButton: HTMLButtonElement | null = null;
  let forwardButton: HTMLButtonElement | null = null;
  let state: NavigationState = { canGoBack: false, canGoForward: false };

  function render(): void {
    if (backButton) backButton.disabled = !state.canGoBack;
    if (forwardButton) forwardButton.disabled = !state.canGoForward;
  }

  function bindButtons(): void {
    const nextBack = document.querySelector<HTMLButtonElement>('[data-desktop-back]');
    const nextForward = document.querySelector<HTMLButtonElement>('[data-desktop-forward]');
    if (nextBack && nextBack !== backButton) {
      backButton = nextBack;
      backButton.addEventListener('click', () => { void navigation.goBack(); });
    }
    if (nextForward && nextForward !== forwardButton) {
      forwardButton = nextForward;
      forwardButton.addEventListener('click', () => { void navigation.goForward(); });
    }
    render();
  }

  navigation.onNavigationStateChange((nextState) => {
    state = nextState;
    render();
  });
  document.addEventListener('astro:after-swap', bindButtons);
  document.addEventListener('astro:page-load', bindButtons);
  bindButtons();
  void navigation.getNavigationState().then((initialState) => {
    state = initialState;
    render();
  });
}
