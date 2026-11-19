/** How each external provider appears in the app; section titles come from here, not from code. */
interface ProviderUi {
  listsKey: string;
  subscribedKey: string;
}

const KAKAO_UI: ProviderUi = { listsKey: "picker.kakao", subscribedKey: "picker.kakaoSubscribed" };

export const PROVIDER_UI: Record<string, ProviderUi> = { kakao: KAKAO_UI };

export const providerUi = (provider: string | null): ProviderUi =>
  (provider ? PROVIDER_UI[provider] : undefined) ?? KAKAO_UI;
