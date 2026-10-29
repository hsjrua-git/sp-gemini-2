# A15 production-build keyboard retry

Tab `tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generation 28, `/schedule`,
Persian, **528×887** after the user narrowed the Review pane. Shipped production
build at :5300 with production-equivalent CSP. Native Enter/Tab/Shift+Tab/Escape;
DOM focus establishes boundary starts and attempts the outside-focus control.

All nine retained checks pass: opening focuses visible `.panel-back` while the
rail toggle is hidden; forward Tab stays inside; reverse Tab from first reaches
`.account-signout`; Tab from last wraps to first; attempted main-button focus is
contained; panel-back focuses the panel list's first link; opening a panel focuses
its first visible control; Escape closes and restores `.nav-toggle`; closed
sidebar is inert. Panel opening was executed in a second open/close cycle.

Earlier 1233×887 resize/zoom attempts did not change viewport width. An initial
inline inspection had one extra closing parenthesis and threw before any action;
corrected inspection and actual key sequences produced the results above.
This establishes the tested desktop-browser width, not Android execution.
