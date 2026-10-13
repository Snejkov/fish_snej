# Apple Home Screen launch

The online game can be added manually from Safari on iPhone and iPad:
Share -> Add to Home Screen -> leave Open as Web App enabled if offered -> Add.
Launch the SnejFishing icon. Existing installations may need to be added again
to pick up the new icon or launch metadata. Do not clear Safari data to do this.

Apple-specific title, capable-mode metadata and an opaque 180px PNG touch icon
are supplied. The optional guide is shown only in Apple mobile launch screens,
including iPads using a desktop-style UA. It is hidden during gameplay and in
an already-standalone session. Android, Windows and desktop Mac have no install
promotion, manifest or standalone CSS applied by this feature.

The browser/OS still controls installation, status bars, orientation, fullscreen
and background suspension. This is not a native application and does not claim
to work in every browser or on every device. Real-device installation is a
separate verification step; desktop mobile emulation cannot verify Safari's OS UI.

No service worker, asset CacheStorage, offline gameplay or profile migration is
added. Authenticated API traffic and WebSocket gameplay remain online and use the
existing server authority. Static files retain the server's no-cache policy.
UI/icon imports are versioned so ordinary reloads request the current release.

Home Screen sessions may have different browser storage. Safari 17.2 and later
copy cookies when installing, but not other local storage; later website data
is not shared. Do not promise automatic transfer of every profile or setting.
If the expected profile is absent, return to its existing Safari session rather
than creating a replacement guest. Nicknames are not account-recovery credentials.

The present guest preview uses HTTP at its existing IP/port; no TLS listener was
found during this change. Apple Home Screen mode does not require a service
worker or a shared installation manifest, so these are not added just to work
around HTTP. HTTPS is still preferred; private account credentials must not be
enabled over this HTTP guest preview. Domain/TLS setup is a separate task.

Primary references:
- https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
- https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios
- https://support.apple.com/en-my/guide/ipad/ipad8f1f7a29/ipados
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://webkit.org/blog/14787/webkit-features-in-safari-17-2/
