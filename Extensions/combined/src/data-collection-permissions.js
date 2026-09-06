const AUTHENTICATION_DATA_PERMISSION = "authenticationInfo";
const ACCOUNT_DATA_PERMISSIONS = Object.freeze([AUTHENTICATION_DATA_PERMISSION]);
const AUTHENTICATION_DATA_DESCRIPTOR = Object.freeze({
  data_collection: ACCOUNT_DATA_PERMISSIONS,
});

function getRuntimeApi() {
  if (typeof browser !== "undefined" && browser?.runtime) return browser.runtime;
  if (typeof chrome !== "undefined" && chrome?.runtime) return chrome.runtime;
  return null;
}

function getPermissionsApi() {
  if (typeof browser !== "undefined" && browser?.permissions) return browser.permissions;
  if (typeof chrome !== "undefined" && chrome?.permissions) return chrome.permissions;
  return null;
}

function usesFirefoxDataCollectionConsent() {
  const manifest = getRuntimeApi()?.getManifest?.();
  return Boolean(manifest?.browser_specific_settings?.gecko?.data_collection_permissions);
}

function callFirefoxPermissionMethod(methodName) {
  const permissions = getPermissionsApi();
  const method = permissions?.[methodName];
  if (typeof method !== "function") return Promise.resolve(false);

  try {
    return Promise.resolve(method.call(permissions, AUTHENTICATION_DATA_DESCRIPTOR)).then(Boolean, () => false);
  } catch (_) {
    return Promise.resolve(false);
  }
}

function queryBackgroundForAuthenticationDataPermission() {
  const runtime = getRuntimeApi();
  if (typeof runtime?.sendMessage !== "function") return Promise.resolve(false);

  if (typeof browser !== "undefined" && browser?.runtime === runtime) {
    try {
      return Promise.resolve(runtime.sendMessage({ message: "ryd_has_authentication_consent" }))
        .then((response) => response?.granted === true)
        .catch(() => false);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  return new Promise((resolve) => {
    try {
      runtime.sendMessage({ message: "ryd_has_authentication_consent" }, (response) => {
        if (runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(response?.granted === true);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function hasAuthenticationDataPermission({ queryBackground = true } = {}) {
  if (!usesFirefoxDataCollectionConsent()) return Promise.resolve(true);
  if (typeof getPermissionsApi()?.contains === "function") return callFirefoxPermissionMethod("contains");
  return queryBackground ? queryBackgroundForAuthenticationDataPermission() : Promise.resolve(false);
}

function requestAuthenticationDataPermission() {
  if (!usesFirefoxDataCollectionConsent()) return Promise.resolve(true);

  // Keep this direct request as the first operation in the login click stack.
  // Firefox requires optional data-collection consent requests to originate from a user gesture.
  return callFirefoxPermissionMethod("request");
}

function authenticationDataPermissionWasRemoved(removedPermissions) {
  return ACCOUNT_DATA_PERMISSIONS.some((permission) => removedPermissions?.data_collection?.includes(permission));
}

function onAuthenticationDataPermissionRemoved(listener) {
  const event = getPermissionsApi()?.onRemoved;
  if (!usesFirefoxDataCollectionConsent() || typeof event?.addListener !== "function") return () => {};

  const wrapped = (removedPermissions) => {
    if (authenticationDataPermissionWasRemoved(removedPermissions)) listener();
  };
  event.addListener(wrapped);
  return () => event.removeListener?.(wrapped);
}

export {
  AUTHENTICATION_DATA_PERMISSION,
  authenticationDataPermissionWasRemoved,
  hasAuthenticationDataPermission,
  onAuthenticationDataPermissionRemoved,
  requestAuthenticationDataPermission,
  usesFirefoxDataCollectionConsent,
};
