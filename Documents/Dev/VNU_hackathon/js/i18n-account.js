/* Synapse– account + Secure Medical Cloud + Favourite Doctors strings (en, ro).
   Load after js/i18n.js. Also exposes window.MedIndexAccountI18n with small helpers
   (t with an English fallback, plurals, server error mapping, dates, numbers, file sizes). */
(function () {
  "use strict";

  var EN = {
    /* ---------- account page ---------- */
    "account.pageTitle": "Your account – Synapse",
    "account.metaDesc": "Sign in or create a Synapse account to manage Premium and your Secure Medical Cloud.",
    "account.skip": "Skip to content",
    "account.offline.title": "Accounts need the local server",
    "account.offline.text": "You opened this page as a local file, so sign-in can't work here.",
    "account.offline.step1": "In a terminal, from the project folder, run",
    "account.offline.step2": "Open",
    "account.loading": "Loading your account…",
    "account.error.title": "We couldn't reach the server",
    "account.retry": "Try again",
    "account.auth.title": "Your Synapse account",
    "account.tabs.aria": "Account",
    "account.tab.login": "Sign in",
    "account.tab.signup": "Create account",
    "account.login.identifier": "Email, phone or username",
    "account.password": "Password",
    "account.show": "Show",
    "account.hide": "Hide",
    "account.showPassword": "Show password",
    "account.hidePassword": "Hide password",
    "account.login.submit": "Sign in",
    "account.login.busy": "Signing in…",
    "account.demo.aria": "Demo account",
    "account.demo.title": "Demo account",
    "account.demo.fill": "Fill in",
    "account.signup.identifier": "Email or phone number",
    "account.signup.identifierHelp": "For example name@example.com or 0722 123 456 / +40 722 123 456.",
    "account.signup.displayName": "Display name",
    "account.optional": "(optional)",
    "account.signup.submit": "Create account",
    "account.signup.busy": "Creating account…",
    "account.signup.privacy": "Your password is sent only to the Synapse server over this connection; it is never stored in your browser.",
    "account.hint.idle": "At least 8 characters",
    "account.hint.ok": "At least 8 characters: done",
    "account.hint.bad": "At least 8 characters ({n} more)",
    "account.val.idEmpty": "Enter your email or phone number.",
    "account.val.emailBad": "That email doesn't look right (e.g. name@example.com).",
    "account.val.phoneBad": "Enter a valid phone number, e.g. 0722 123 456 or +40 722 123 456.",
    "account.val.idKind": "Enter an email address or a phone number.",
    "account.val.loginId": "Enter your email, phone or username.",
    "account.val.loginPw": "Enter your password.",
    "account.val.pwShort": "Password must be at least 8 characters.",
    "account.next.note": "Sign in or create an account to continue to {page}.",
    "account.next.premium": "Premium",
    "account.next.cloud": "the Medical Cloud",
    "account.next.doctors": "the doctor directory",
    "account.next.index": "the home page",
    "account.member": "Synapse member",
    "account.idType.email": "Email",
    "account.idType.phone": "Phone",
    "account.idType.username": "Username",
    "account.idLine": "{type}: {value}",
    "account.plan": "Plan",
    "account.plan.regular": "Regular",
    "account.plan.premium": "Premium",
    "account.plan.premiumWith": "Premium · {plan}",
    "account.plan.monthly": "Monthly",
    "account.plan.yearly": "Yearly",
    "account.renews": "Renews",
    "account.memberSince": "Member since",
    "account.shortcuts.aria": "Account shortcuts",
    "account.link.goPremium": "Go Premium",
    "account.link.goPremiumSub": "Unlock the Secure Medical Cloud",
    "account.link.managePremium": "Manage Premium",
    "account.link.managePremiumSub": "Plan, renewal and cancellation",
    "account.link.cloud": "Medical Cloud",
    "account.link.cloudSubPremium": "Your files, ChatBot History and favourite doctors",
    "account.link.cloudSubRegular": "Premium feature",
    "account.logout": "Sign out",
    "account.logout.busy": "Signing out…",
    "account.logout.failed": "Couldn't sign out: {error}",
    "account.status.signedIn": "You're signed in.",
    "account.status.welcome": "Welcome! Your account is ready.",
    "account.reviews.title": "My reviews",
    "account.reviews.loading": "Loading your reviews…",
    "account.reviews.loadErr": "Your reviews could not be loaded. Please try again.",
    "account.reviews.empty": "You haven't reviewed any doctors yet.",
    "account.reviews.findDoctors": "Find a doctor to rate",
    "account.reviews.gone": "Doctor no longer listed",
    "account.reviews.stars": "{n} out of 5 stars",
    "account.reviews.view": "View doctor",
    "account.reviews.viewAria": "View {name}",
    "account.reviews.delete": "Delete",
    "account.reviews.deleteAria": "Delete your review of {name}",
    "account.reviews.confirmTitle": "Delete your review?",
    "account.reviews.confirmText": "Your review of {name} will be removed from Synapse. You can rate this doctor again later.",
    "account.reviews.confirmOk": "Delete review",
    "account.reviews.cancel": "Cancel",
    "account.reviews.deleted": "Review deleted",
    "account.reviews.deleteErr": "Your review could not be deleted. Please try again.",
    "account.footer.homeAria": "Synapse home",
    "account.footer.aria": "Footer",
    "account.footer.doctors": "Find Doctors",
    "account.footer.assistant": "AI Assistant",
    "account.footer.premium": "Premium",
    "account.footer.account": "Account",
    "account.footer.dataTitle": "About the data.",
    "account.footer.dataText": "Data collected from public pages of each network. Prices may change; confirm with the clinic before booking.",
    "account.footer.aiTitle": "About the AI.",
    "account.footer.aiText": "SynapseAssistant gives general health information, not a diagnosis, and its advice may be wrong. It never replaces a doctor. In an emergency, call 112.",

    /* ---------- errors (client + known server messages) ---------- */
    "account.err.offline": "Accounts need the local server.",
    "account.err.timeout": "The server took too long to answer. Please try again.",
    "account.err.unreachable": "Can't reach the server. Is python3 server/proxy.py running?",
    "account.err.tooMany": "Too many attempts. Please wait a minute and try again.",
    "account.err.generic": "Something went wrong. Please try again.",
    "account.err.exists": "An account with this email or phone already exists. Try signing in.",
    "account.err.loginRequired": "Please sign in first.",
    "account.err.premiumRequired": "This needs a Premium plan.",
    "account.err.tooManyServer": "Too many attempts. Try again in a few minutes.",
    "account.err.badIdentifier": "Enter a valid email address or phone number.",
    "account.err.badDisplayName": "That display name can't be used.",
    "account.err.identifierRequired": "Enter your email, phone or username.",
    "account.err.passwordRequired": "Enter your password.",
    "account.err.badChars": "This contains characters that can't be used.",
    "account.err.invalidCredentials": "Wrong email, phone, username or password.",
    "account.err.pwBadChars": "The password contains characters that can't be used.",
    "account.err.pwMin": "Password must be at least {n} characters.",
    "account.err.pwMax": "Password must be at most {n} characters.",
    "account.err.forbidden": "The server refused this request. Reload the page and try again.",
    "account.err.internal": "The server had a problem. Please try again.",
    "account.err.notFound": "It no longer exists.",
    "account.err.tooManyFolders": "You have reached the folder limit.",
    "account.err.folderExists": "A folder with this name already exists.",
    "account.err.folderProtected": "This folder can't be deleted.",
    "account.err.badFolder": "That folder isn't valid.",
    "account.err.badFileType": "That file type isn't valid.",
    "account.err.badFileSize": "That file size isn't valid.",
    "account.err.folderNotFound": "That folder no longer exists.",
    "account.err.noUploadHere": "Files can't be uploaded to this folder.",
    "account.err.tooManyFiles": "You have reached the file limit.",
    "account.err.storageFull": "Storage full.",
    "account.err.unknownDoctor": "This doctor is no longer listed.",
    "account.err.tooManyFavorites": "You have saved the maximum number of favourite doctors.",

    /* ---------- cloud page ---------- */
    "cloud.pageTitle": "Secure Medical Cloud – Synapse",
    "cloud.metaDesc": "Keep your medical file details, ChatBot History and favourite doctors organised in the SynapseSecure Medical Cloud (Premium).",
    "cloud.loading": "Loading your cloud…",
    "cloud.offline.title": "The Medical Cloud needs the local server",
    "cloud.offline.text1": "You opened this page as a local file. Run",
    "cloud.offline.text2": "in the project folder, then open",
    "cloud.error.title": "We couldn't load your cloud",
    "cloud.signin.title": "Sign in to open your Medical Cloud",
    "cloud.signin.text": "Your files, ChatBot History and favourite doctors are private to your account.",
    "cloud.signin.login": "Sign in",
    "cloud.signin.signup": "Create account",
    "cloud.upsell.badge": "Premium feature",
    "cloud.upsell.title": "Secure Medical Cloud is part of Premium",
    "cloud.upsell.text": "Keep your medical documents organised in folders, find every ChatBot conversation again later and save your favourite doctors.",
    "cloud.upsell.perk1": "5 GB of space for your medical file details",
    "cloud.upsell.perk2": "ChatBot History: re-read and continue past conversations",
    "cloud.upsell.perk3": "Favourite Doctors: the doctors you saved, in one place",
    "cloud.upsell.perk4": "Folders, sorting, grid and list views",
    "cloud.upsell.plans": "See Premium plans",
    "cloud.upsell.account": "Your account",
    "cloud.title": "Secure Medical Cloud",
    "cloud.side.aria": "Folders and storage",
    "cloud.folders": "Folders",
    "cloud.newFolder": "New folder",
    "cloud.storage": "Storage",
    "cloud.demoNote": "Demo: files are simulated — only file details (name, type, size, date) are saved, never the file contents.",
    "cloud.meter": "{used} used of {total}",
    "cloud.meter.full": "{used} used of {total} (almost full)",
    "cloud.sort": "Sort",
    "cloud.sort.date": "Newest first",
    "cloud.sort.name": "Name (A–Z)",
    "cloud.sort.size": "Largest first",
    "cloud.view.aria": "View",
    "cloud.view.grid": "Grid view",
    "cloud.view.list": "List view",
    "cloud.newChat": "New chat",
    "cloud.upload": "Upload",
    "cloud.deleteFolder": "Delete folder",
    "cloud.drop.strong": "Drag files here",
    "cloud.drop.or": "or",
    "cloud.drop.browse": "browse",
    "cloud.drop.rest": ". Only the file details are saved.",
    "cloud.folder.chats": "ChatBot History",
    "cloud.folder.none": "No folder",
    "cloud.items.one": "{n} item",
    "cloud.items.other": "{n} items",
    "cloud.count.files.one": "{n} file",
    "cloud.count.files.other": "{n} files",
    "cloud.count.chats.one": "{n} conversation",
    "cloud.count.chats.other": "{n} conversations",
    "cloud.empty.noFolders.title": "No folders yet",
    "cloud.empty.noFolders.text": "Create a folder to get started.",
    "cloud.empty.chats.title": "No conversations yet",
    "cloud.empty.chats.text": "Chats you have with the Synapse assistant while signed in appear here. Start one with New chat.",
    "cloud.empty.folder.title": "This folder is empty",
    "cloud.empty.folder.text": "Upload or drag files here. Only their details are saved.",
    "cloud.kind.pdf": "PDF",
    "cloud.kind.dicom": "DICOM scan",
    "cloud.kind.image": "Image",
    "cloud.kind.video": "Video",
    "cloud.kind.audio": "Audio",
    "cloud.kind.sheet": "Spreadsheet",
    "cloud.kind.doc": "Document",
    "cloud.kind.archive": "Archive",
    "cloud.kind.ext": "{ext} file",
    "cloud.kind.file": "File",
    "cloud.kind.chat": "Conversation",
    "cloud.untitledChat": "Untitled chat",
    "cloud.delete": "Delete",
    "cloud.deleteItem": "Delete {name}",
    "cloud.cancel": "Cancel",
    "cloud.confirm.file.title": "Delete this file?",
    "cloud.confirm.file.text": "“{name}” will be removed from your cloud. This can't be undone.",
    "cloud.confirm.file.ok": "Delete file",
    "cloud.confirm.chat.title": "Delete this conversation?",
    "cloud.confirm.chat.text": "“{name}” will be removed from your ChatBot History. This can't be undone.",
    "cloud.confirm.chat.ok": "Delete chat",
    "cloud.confirm.folder.title": "Delete this folder?",
    "cloud.confirm.folder.text.one": "The folder “{name}” and its {n} file will be deleted. This can't be undone.",
    "cloud.confirm.folder.text.other": "The folder “{name}” and its {n} files will be deleted. This can't be undone.",
    "cloud.confirm.folder.empty": "The empty folder “{name}” will be deleted.",
    "cloud.confirm.folder.ok": "Delete folder",
    "cloud.status.fileDeleted": "Deleted “{name}”.",
    "cloud.status.chatDeleted": "Conversation deleted.",
    "cloud.status.folderDeleted": "Folder “{name}” deleted.",
    "cloud.status.folderCreated": "Folder “{name}” created.",
    "cloud.status.saving.one": "Saving details of {n} file…",
    "cloud.status.saving.other": "Saving details of {n} files…",
    "cloud.status.storageFull": "Storage full: “{name}” ({size}) doesn't fit. Delete some files to free up space.",
    "cloud.status.storageFullAfter": "Storage full: “{name}” ({size}) doesn't fit. {n} added before that. Delete some files to free up space.",
    "cloud.status.addFailed": "Couldn't add “{name}”: {error}",
    "cloud.status.addFailedAfter": "{n} added. Couldn't add “{name}”: {error}",
    "cloud.status.addedOne": "Added “{name}”.",
    "cloud.status.addedMany.other": "Added {n} files.",
    "cloud.status.chatGone": "That conversation no longer exists.",
    "cloud.err.storageFull": "Storage full. Delete some files to free up space.",
    "cloud.err.generic": "Something went wrong.",
    "cloud.folderDialog.title": "New folder",
    "cloud.folderDialog.label": "Folder name",
    "cloud.folderDialog.create": "Create",
    "cloud.folderDialog.empty": "Enter a folder name.",
    "cloud.reader.back": "ChatBot History",
    "cloud.reader.continue": "Continue in assistant",
    "cloud.reader.newChat": "New chat",
    "cloud.reader.delete": "Delete chat",
    "cloud.reader.readonly": "Read-only copy of your conversation.",
    "cloud.reader.messagesAria": "Messages",
    "cloud.reader.noMessages": "This conversation has no messages yet.",
    "cloud.reader.loading": "Loading conversation…",
    "cloud.reader.failed": "Couldn't open this conversation",
    "cloud.reader.count.one": "{n} message",
    "cloud.reader.count.other": "{n} messages",
    "cloud.reader.lastActivity": "last activity {date}",
    "cloud.reader.emergency": "Possible emergency.",
    "cloud.reader.emergencyText": "If this is happening now, call 112 immediately.",
    "cloud.reader.you": "You",
    "cloud.reader.assistant": "SynapseAssistant",
    "cloud.reader.specialtiesAria": "Suggested specialties",
    "cloud.size.b": "{n} B",
    "cloud.size.kb": "{n} KB",
    "cloud.size.mb": "{n} MB",
    "cloud.size.gb": "{n} GB",
    "cloud.size.tb": "{n} TB",

    /* ---------- favourite doctors ---------- */
    "fav.folder": "Favourite Doctors",
    "fav.count.one": "{n} doctor",
    "fav.count.other": "{n} doctors",
    "fav.loading": "Loading your favourite doctors…",
    "fav.loadFailed": "Couldn't load your favourite doctors: {error}",
    "fav.retry": "Try again",
    "fav.empty.title": "No favourite doctors yet",
    "fav.empty.text": "In Find Doctors, tap the heart button on a doctor's card to save them here.",
    "fav.empty.action": "Find doctors",
    "fav.view": "View doctor",
    "fav.viewAria": "View {name}",
    "fav.remove": "Remove from favourites",
    "fav.removeAria": "Remove {name} from favourites",
    "fav.removed": "Removed {name} from your favourites.",
    "fav.removeFailed": "Couldn't remove this doctor: {error}",
    "fav.gone": "Doctor no longer listed",
    "fav.goneText": "This doctor is no longer in the Synapse directory.",
    "fav.goneName": "the doctor",
    "fav.price": "{price} RON",
    "fav.noUpload": "Doctors are added with the heart button in Find Doctors; files can't be uploaded here."
  };

  var RO = {
    /* ---------- account page ---------- */
    "account.pageTitle": "Contul tău – Synapse",
    "account.metaDesc": "Conectează-te sau creează un cont Synapse pentru a gestiona Premium și Cloudul Medical Securizat.",
    "account.skip": "Sari la conținut",
    "account.offline.title": "Conturile au nevoie de serverul local",
    "account.offline.text": "Ai deschis pagina ca fișier local, așa că autentificarea nu funcționează aici.",
    "account.offline.step1": "Într-un terminal, din folderul proiectului, rulează",
    "account.offline.step2": "Deschide",
    "account.loading": "Se încarcă contul…",
    "account.error.title": "Nu am putut contacta serverul",
    "account.retry": "Încearcă din nou",
    "account.auth.title": "Contul tău Synapse",
    "account.tabs.aria": "Cont",
    "account.tab.login": "Conectare",
    "account.tab.signup": "Creează cont",
    "account.login.identifier": "E-mail, telefon sau nume de utilizator",
    "account.password": "Parolă",
    "account.show": "Arată",
    "account.hide": "Ascunde",
    "account.showPassword": "Arată parola",
    "account.hidePassword": "Ascunde parola",
    "account.login.submit": "Conectează-te",
    "account.login.busy": "Se conectează…",
    "account.demo.aria": "Cont demo",
    "account.demo.title": "Cont demo",
    "account.demo.fill": "Completează",
    "account.signup.identifier": "E-mail sau număr de telefon",
    "account.signup.identifierHelp": "De exemplu nume@exemplu.ro sau 0722 123 456 / +40 722 123 456.",
    "account.signup.displayName": "Nume afișat",
    "account.optional": "(opțional)",
    "account.signup.submit": "Creează contul",
    "account.signup.busy": "Se creează contul…",
    "account.signup.privacy": "Parola ta este trimisă doar serverului Synapse prin această conexiune; nu este salvată niciodată în browser.",
    "account.hint.idle": "Cel puțin 8 caractere",
    "account.hint.ok": "Cel puțin 8 caractere: gata",
    "account.hint.bad": "Cel puțin 8 caractere (mai trebuie {n})",
    "account.val.idEmpty": "Introdu adresa de e-mail sau numărul de telefon.",
    "account.val.emailBad": "Adresa de e-mail nu pare corectă (de ex. nume@exemplu.ro).",
    "account.val.phoneBad": "Introdu un număr de telefon valid, de ex. 0722 123 456 sau +40 722 123 456.",
    "account.val.idKind": "Introdu o adresă de e-mail sau un număr de telefon.",
    "account.val.loginId": "Introdu e-mailul, telefonul sau numele de utilizator.",
    "account.val.loginPw": "Introdu parola.",
    "account.val.pwShort": "Parola trebuie să aibă cel puțin 8 caractere.",
    "account.next.note": "Conectează-te sau creează un cont pentru a continua către {page}.",
    "account.next.premium": "Premium",
    "account.next.cloud": "Cloudul Medical",
    "account.next.doctors": "lista de medici",
    "account.next.index": "pagina principală",
    "account.member": "Membru Synapse",
    "account.idType.email": "E-mail",
    "account.idType.phone": "Telefon",
    "account.idType.username": "Nume de utilizator",
    "account.idLine": "{type}: {value}",
    "account.plan": "Plan",
    "account.plan.regular": "Standard",
    "account.plan.premium": "Premium",
    "account.plan.premiumWith": "Premium · {plan}",
    "account.plan.monthly": "Lunar",
    "account.plan.yearly": "Anual",
    "account.renews": "Se reînnoiește",
    "account.memberSince": "Membru din",
    "account.shortcuts.aria": "Scurtături cont",
    "account.link.goPremium": "Treci la Premium",
    "account.link.goPremiumSub": "Deblochează Cloudul Medical Securizat",
    "account.link.managePremium": "Gestionează Premium",
    "account.link.managePremiumSub": "Plan, reînnoire și anulare",
    "account.link.cloud": "Cloud Medical",
    "account.link.cloudSubPremium": "Fișierele tale, Istoricul ChatBot și medicii favoriți",
    "account.link.cloudSubRegular": "Funcție Premium",
    "account.logout": "Deconectare",
    "account.logout.busy": "Se deconectează…",
    "account.logout.failed": "Deconectarea nu a reușit: {error}",
    "account.status.signedIn": "Te-ai conectat.",
    "account.status.welcome": "Bine ai venit! Contul tău este gata.",
    "account.reviews.title": "Recenziile mele",
    "account.reviews.loading": "Se încarcă recenziile tale…",
    "account.reviews.loadErr": "Recenziile tale nu au putut fi încărcate. Încearcă din nou.",
    "account.reviews.empty": "Încă nu ai evaluat niciun medic.",
    "account.reviews.findDoctors": "Găsește un medic de evaluat",
    "account.reviews.gone": "Medic care nu mai este listat",
    "account.reviews.stars": "{n} din 5 stele",
    "account.reviews.view": "Vezi medicul",
    "account.reviews.viewAria": "Vezi {name}",
    "account.reviews.delete": "Șterge",
    "account.reviews.deleteAria": "Șterge recenzia ta pentru {name}",
    "account.reviews.confirmTitle": "Ștergi recenzia?",
    "account.reviews.confirmText": "Recenzia ta pentru {name} va fi eliminată din Synapse. Poți evalua din nou acest medic mai târziu.",
    "account.reviews.confirmOk": "Șterge recenzia",
    "account.reviews.cancel": "Anulează",
    "account.reviews.deleted": "Recenzie ștearsă",
    "account.reviews.deleteErr": "Recenzia nu a putut fi ștearsă. Încearcă din nou.",
    "account.footer.homeAria": "Synapse– pagina principală",
    "account.footer.aria": "Subsol",
    "account.footer.doctors": "Găsește medici",
    "account.footer.assistant": "Asistent AI",
    "account.footer.premium": "Premium",
    "account.footer.account": "Cont",
    "account.footer.dataTitle": "Despre date.",
    "account.footer.dataText": "Date colectate din paginile publice ale fiecărei rețele. Prețurile se pot schimba; confirmă cu clinica înainte de programare.",
    "account.footer.aiTitle": "Despre AI.",
    "account.footer.aiText": "Asistentul Synapse oferă informații generale despre sănătate, nu un diagnostic, iar sfaturile lui pot fi greșite. Nu înlocuiește niciodată un medic. În caz de urgență, sună la 112.",

    /* ---------- errors ---------- */
    "account.err.offline": "Conturile au nevoie de serverul local.",
    "account.err.timeout": "Serverul a răspuns prea greu. Te rugăm să încerci din nou.",
    "account.err.unreachable": "Serverul nu poate fi contactat. Rulează python3 server/proxy.py?",
    "account.err.tooMany": "Prea multe încercări. Așteaptă un minut și încearcă din nou.",
    "account.err.generic": "Ceva nu a mers. Te rugăm să încerci din nou.",
    "account.err.exists": "Există deja un cont cu acest e-mail sau telefon. Încearcă să te conectezi.",
    "account.err.loginRequired": "Conectează-te mai întâi.",
    "account.err.premiumRequired": "Este nevoie de un plan Premium.",
    "account.err.tooManyServer": "Prea multe încercări. Încearcă din nou peste câteva minute.",
    "account.err.badIdentifier": "Introdu o adresă de e-mail sau un număr de telefon valid.",
    "account.err.badDisplayName": "Acest nume afișat nu poate fi folosit.",
    "account.err.identifierRequired": "Introdu e-mailul, telefonul sau numele de utilizator.",
    "account.err.passwordRequired": "Introdu parola.",
    "account.err.badChars": "Conține caractere care nu pot fi folosite.",
    "account.err.invalidCredentials": "E-mailul, telefonul, numele de utilizator sau parola sunt greșite.",
    "account.err.pwBadChars": "Parola conține caractere care nu pot fi folosite.",
    "account.err.pwMin": "Parola trebuie să aibă cel puțin {n} caractere.",
    "account.err.pwMax": "Parola poate avea cel mult {n} de caractere.",
    "account.err.forbidden": "Serverul a refuzat cererea. Reîncarcă pagina și încearcă din nou.",
    "account.err.internal": "Serverul a avut o problemă. Te rugăm să încerci din nou.",
    "account.err.notFound": "Nu mai există.",
    "account.err.tooManyFolders": "Ai atins limita de foldere.",
    "account.err.folderExists": "Există deja un folder cu acest nume.",
    "account.err.folderProtected": "Acest folder nu poate fi șters.",
    "account.err.badFolder": "Folderul nu este valid.",
    "account.err.badFileType": "Tipul de fișier nu este valid.",
    "account.err.badFileSize": "Dimensiunea fișierului nu este validă.",
    "account.err.folderNotFound": "Folderul nu mai există.",
    "account.err.noUploadHere": "Nu se pot încărca fișiere în acest folder.",
    "account.err.tooManyFiles": "Ai atins limita de fișiere.",
    "account.err.storageFull": "Spațiu de stocare plin.",
    "account.err.unknownDoctor": "Acest medic nu mai este listat.",
    "account.err.tooManyFavorites": "Ai salvat numărul maxim de medici favoriți.",

    /* ---------- cloud page ---------- */
    "cloud.pageTitle": "Cloud Medical Securizat – Synapse",
    "cloud.metaDesc": "Păstrează organizate detaliile fișierelor medicale, Istoricul ChatBot și medicii favoriți în Cloudul Medical Securizat Synapse(Premium).",
    "cloud.loading": "Se încarcă cloudul…",
    "cloud.offline.title": "Cloudul Medical are nevoie de serverul local",
    "cloud.offline.text1": "Ai deschis pagina ca fișier local. Rulează",
    "cloud.offline.text2": "în folderul proiectului, apoi deschide",
    "cloud.error.title": "Nu am putut încărca cloudul",
    "cloud.signin.title": "Conectează-te pentru a deschide Cloudul Medical",
    "cloud.signin.text": "Fișierele, Istoricul ChatBot și medicii favoriți sunt private, doar în contul tău.",
    "cloud.signin.login": "Conectare",
    "cloud.signin.signup": "Creează cont",
    "cloud.upsell.badge": "Funcție Premium",
    "cloud.upsell.title": "Cloudul Medical Securizat face parte din Premium",
    "cloud.upsell.text": "Păstrează documentele medicale organizate în foldere, regăsește oricând conversațiile cu ChatBot-ul și salvează-ți medicii favoriți.",
    "cloud.upsell.perk1": "5 GB de spațiu pentru detaliile fișierelor medicale",
    "cloud.upsell.perk2": "Istoric ChatBot: recitește și continuă conversațiile anterioare",
    "cloud.upsell.perk3": "Medici favoriți: medicii salvați, într-un singur loc",
    "cloud.upsell.perk4": "Foldere, sortare, afișare în grilă și listă",
    "cloud.upsell.plans": "Vezi planurile Premium",
    "cloud.upsell.account": "Contul tău",
    "cloud.title": "Cloud Medical Securizat",
    "cloud.side.aria": "Foldere și spațiu de stocare",
    "cloud.folders": "Foldere",
    "cloud.newFolder": "Folder nou",
    "cloud.storage": "Spațiu de stocare",
    "cloud.demoNote": "Demo: fișierele sunt simulate — se salvează doar detaliile lor (nume, tip, dimensiune, dată), niciodată conținutul.",
    "cloud.meter": "{used} folosiți din {total}",
    "cloud.meter.full": "{used} folosiți din {total} (aproape plin)",
    "cloud.sort": "Sortare",
    "cloud.sort.date": "Cele mai noi",
    "cloud.sort.name": "Nume (A–Z)",
    "cloud.sort.size": "Cele mai mari",
    "cloud.view.aria": "Afișare",
    "cloud.view.grid": "Afișare în grilă",
    "cloud.view.list": "Afișare în listă",
    "cloud.newChat": "Conversație nouă",
    "cloud.upload": "Încarcă",
    "cloud.deleteFolder": "Șterge folderul",
    "cloud.drop.strong": "Trage fișierele aici",
    "cloud.drop.or": "sau",
    "cloud.drop.browse": "alege din calculator",
    "cloud.drop.rest": ". Se salvează doar detaliile fișierelor.",
    "cloud.folder.chats": "Istoric ChatBot",
    "cloud.folder.none": "Niciun folder",
    "cloud.items.one": "{n} element",
    "cloud.items.few": "{n} elemente",
    "cloud.items.other": "{n} de elemente",
    "cloud.count.files.one": "{n} fișier",
    "cloud.count.files.few": "{n} fișiere",
    "cloud.count.files.other": "{n} de fișiere",
    "cloud.count.chats.one": "{n} conversație",
    "cloud.count.chats.few": "{n} conversații",
    "cloud.count.chats.other": "{n} de conversații",
    "cloud.empty.noFolders.title": "Încă nu ai foldere",
    "cloud.empty.noFolders.text": "Creează un folder ca să începi.",
    "cloud.empty.chats.title": "Încă nu ai conversații",
    "cloud.empty.chats.text": "Conversațiile cu asistentul Synapse purtate cât timp ești conectat apar aici. Începe una cu Conversație nouă.",
    "cloud.empty.folder.title": "Acest folder este gol",
    "cloud.empty.folder.text": "Încarcă sau trage fișiere aici. Se salvează doar detaliile lor.",
    "cloud.kind.pdf": "PDF",
    "cloud.kind.dicom": "Imagistică DICOM",
    "cloud.kind.image": "Imagine",
    "cloud.kind.video": "Video",
    "cloud.kind.audio": "Audio",
    "cloud.kind.sheet": "Foaie de calcul",
    "cloud.kind.doc": "Document",
    "cloud.kind.archive": "Arhivă",
    "cloud.kind.ext": "Fișier {ext}",
    "cloud.kind.file": "Fișier",
    "cloud.kind.chat": "Conversație",
    "cloud.untitledChat": "Conversație fără titlu",
    "cloud.delete": "Șterge",
    "cloud.deleteItem": "Șterge {name}",
    "cloud.cancel": "Anulează",
    "cloud.confirm.file.title": "Ștergi acest fișier?",
    "cloud.confirm.file.text": "„{name}” va fi eliminat din cloud. Acțiunea nu poate fi anulată.",
    "cloud.confirm.file.ok": "Șterge fișierul",
    "cloud.confirm.chat.title": "Ștergi această conversație?",
    "cloud.confirm.chat.text": "„{name}” va fi eliminată din Istoricul ChatBot. Acțiunea nu poate fi anulată.",
    "cloud.confirm.chat.ok": "Șterge conversația",
    "cloud.confirm.folder.title": "Ștergi acest folder?",
    "cloud.confirm.folder.text.one": "Folderul „{name}” și {n} fișier din el vor fi șterse. Acțiunea nu poate fi anulată.",
    "cloud.confirm.folder.text.few": "Folderul „{name}” și cele {n} fișiere din el vor fi șterse. Acțiunea nu poate fi anulată.",
    "cloud.confirm.folder.text.other": "Folderul „{name}” și cele {n} de fișiere din el vor fi șterse. Acțiunea nu poate fi anulată.",
    "cloud.confirm.folder.empty": "Folderul gol „{name}” va fi șters.",
    "cloud.confirm.folder.ok": "Șterge folderul",
    "cloud.status.fileDeleted": "„{name}” a fost șters.",
    "cloud.status.chatDeleted": "Conversația a fost ștearsă.",
    "cloud.status.folderDeleted": "Folderul „{name}” a fost șters.",
    "cloud.status.folderCreated": "Folderul „{name}” a fost creat.",
    "cloud.status.saving.one": "Se salvează detaliile pentru {n} fișier…",
    "cloud.status.saving.few": "Se salvează detaliile pentru {n} fișiere…",
    "cloud.status.saving.other": "Se salvează detaliile pentru {n} de fișiere…",
    "cloud.status.storageFull": "Spațiu plin: „{name}” ({size}) nu mai încape. Șterge câteva fișiere ca să eliberezi spațiu.",
    "cloud.status.storageFullAfter": "Spațiu plin: „{name}” ({size}) nu mai încape. Înainte au fost adăugate {n}. Șterge câteva fișiere ca să eliberezi spațiu.",
    "cloud.status.addFailed": "Nu am putut adăuga „{name}”: {error}",
    "cloud.status.addFailedAfter": "Au fost adăugate {n}. Nu am putut adăuga „{name}”: {error}",
    "cloud.status.addedOne": "A fost adăugat „{name}”.",
    "cloud.status.addedMany.few": "Au fost adăugate {n} fișiere.",
    "cloud.status.addedMany.other": "Au fost adăugate {n} de fișiere.",
    "cloud.status.chatGone": "Conversația nu mai există.",
    "cloud.err.storageFull": "Spațiu de stocare plin. Șterge câteva fișiere ca să eliberezi spațiu.",
    "cloud.err.generic": "Ceva nu a mers.",
    "cloud.folderDialog.title": "Folder nou",
    "cloud.folderDialog.label": "Numele folderului",
    "cloud.folderDialog.create": "Creează",
    "cloud.folderDialog.empty": "Introdu un nume pentru folder.",
    "cloud.reader.back": "Istoric ChatBot",
    "cloud.reader.continue": "Continuă în asistent",
    "cloud.reader.newChat": "Conversație nouă",
    "cloud.reader.delete": "Șterge conversația",
    "cloud.reader.readonly": "Copie doar pentru citire a conversației tale.",
    "cloud.reader.messagesAria": "Mesaje",
    "cloud.reader.noMessages": "Această conversație nu are încă mesaje.",
    "cloud.reader.loading": "Se încarcă conversația…",
    "cloud.reader.failed": "Nu am putut deschide conversația",
    "cloud.reader.count.one": "{n} mesaj",
    "cloud.reader.count.few": "{n} mesaje",
    "cloud.reader.count.other": "{n} de mesaje",
    "cloud.reader.lastActivity": "ultima activitate {date}",
    "cloud.reader.emergency": "Posibilă urgență.",
    "cloud.reader.emergencyText": "Dacă se întâmplă acum, sună imediat la 112.",
    "cloud.reader.you": "Tu",
    "cloud.reader.assistant": "Asistentul Synapse",
    "cloud.reader.specialtiesAria": "Specialități sugerate",
    "cloud.size.b": "{n} B",
    "cloud.size.kb": "{n} KB",
    "cloud.size.mb": "{n} MB",
    "cloud.size.gb": "{n} GB",
    "cloud.size.tb": "{n} TB",

    /* ---------- favourite doctors ---------- */
    "fav.folder": "Medici Favoriți",
    "fav.count.one": "{n} medic",
    "fav.count.few": "{n} medici",
    "fav.count.other": "{n} de medici",
    "fav.loading": "Se încarcă medicii favoriți…",
    "fav.loadFailed": "Nu am putut încărca medicii favoriți: {error}",
    "fav.retry": "Încearcă din nou",
    "fav.empty.title": "Încă nu ai medici favoriți",
    "fav.empty.text": "În Găsește medici, apasă butonul cu inimă de pe cardul unui medic ca să-l salvezi aici.",
    "fav.empty.action": "Găsește medici",
    "fav.view": "Vezi medicul",
    "fav.viewAria": "Vezi {name}",
    "fav.remove": "Elimină din favoriți",
    "fav.removeAria": "Elimină {name} din favoriți",
    "fav.removed": "{name} a fost eliminat din favoriți.",
    "fav.removeFailed": "Nu am putut elimina medicul: {error}",
    "fav.gone": "Medicul nu mai este listat",
    "fav.goneText": "Acest medic nu mai apare în lista Synapse.",
    "fav.goneName": "medicul",
    "fav.price": "{price} lei",
    "fav.noUpload": "Medicii se adaugă cu butonul cu inimă din Găsește medici; aici nu se pot încărca fișiere."
  };

  /* Known server error messages -> dictionary keys. Unknown messages are shown as-is. */
  var SERVER_ERRORS = {
    "Login required": "account.err.loginRequired",
    "Premium required": "account.err.premiumRequired",
    "Too many attempts. Try again in a few minutes.": "account.err.tooManyServer",
    "Enter a valid email address or phone number": "account.err.badIdentifier",
    "Invalid displayName": "account.err.badDisplayName",
    "Account already exists": "account.err.exists",
    "Identifier is required": "account.err.identifierRequired",
    "Password is required": "account.err.passwordRequired",
    "Invalid characters": "account.err.badChars",
    "Invalid credentials": "account.err.invalidCredentials",
    "Password contains invalid characters": "account.err.pwBadChars",
    "forbidden": "account.err.forbidden",
    "internal error": "account.err.internal",
    "Not found": "account.err.notFound",
    "not found": "account.err.notFound",
    "Too many folders": "account.err.tooManyFolders",
    "A folder with this name already exists": "account.err.folderExists",
    "This folder cannot be deleted": "account.err.folderProtected",
    "Invalid folder": "account.err.badFolder",
    "Invalid folderId": "account.err.badFolder",
    "Invalid file type": "account.err.badFileType",
    "Invalid file size": "account.err.badFileSize",
    "Folder not found": "account.err.folderNotFound",
    "Files cannot be uploaded to this folder": "account.err.noUploadHere",
    "Too many files": "account.err.tooManyFiles",
    "Storage full": "account.err.storageFull",
    "Unknown doctor": "account.err.unknownDoctor",
    "Too many favorites": "account.err.tooManyFavorites",
    "Too many favourites": "account.err.tooManyFavorites"
  };

  var I18N = window.MedIndexI18n;
  if (I18N && typeof I18N.register === "function") {
    I18N.register("en", EN);
    I18N.register("ro", RO);
  }

  function lang() { return I18N && I18N.getLang ? I18N.getLang() : "en"; }

  function interp(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m;
    });
  }

  // t() with a fallback to this file's dictionaries when the core is missing or lacks the key.
  function t(key, vars) {
    var s = null;
    if (I18N && typeof I18N.t === "function") {
      s = I18N.t(key, vars);
      if (s === key) s = null;
    }
    if (s == null) {
      var d = lang() === "ro" ? RO : EN;
      var raw = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : (Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : null);
      s = raw == null ? key : interp(raw, vars);
    }
    return s;
  }
  function has(key) {
    if (I18N && typeof I18N.has === "function" && I18N.has(key)) return true;
    return Object.prototype.hasOwnProperty.call(EN, key);
  }

  // Plural category: en one/other; ro one / few (0, 2-19, n%100 1-19) / other ("de" form).
  function pluralCat(n) {
    n = Math.abs(Number(n) || 0);
    if (n === 1) return "one";
    if (lang() === "ro") {
      var r = n % 100;
      return n === 0 || (r >= 1 && r <= 19) ? "few" : "other";
    }
    return "other";
  }
  function plural(base, n, vars) {
    var v = { n: formatNumber(n) };
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) v[k] = vars[k];
    var key = base + "." + pluralCat(n);
    if (!has(key)) key = base + ".other";
    return t(key, v);
  }

  function formatNumber(n, opts) {
    if (I18N && typeof I18N.formatNumber === "function") return I18N.formatNumber(n, opts);
    var x = Number(n);
    try { return x.toLocaleString(lang() === "ro" ? "ro-RO" : "en-GB", opts); } catch (e) { return String(n); }
  }

  function formatDate(d, opts) {
    if (!d) return "";
    if (I18N && typeof I18N.formatDate === "function") return I18N.formatDate(d, opts);
    try { return d.toLocaleDateString(lang() === "ro" ? "ro-RO" : "en-GB", opts || { day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return d.toDateString(); }
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return t("cloud.size.b", { n: formatNumber(n) });
    var units = ["kb", "mb", "gb", "tb"];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    var whole = n >= 100 || Math.abs(n - Math.round(n)) < 0.05;
    var s = formatNumber(whole ? Math.round(n) : Math.round(n * 10) / 10, whole ? undefined : { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return t("cloud.size." + units[i], { n: s });
  }

  function errorKey(msg) {
    if (typeof msg !== "string") return null;
    if (Object.prototype.hasOwnProperty.call(SERVER_ERRORS, msg)) return { k: SERVER_ERRORS[msg] };
    var m = /^Password must be at (least|most) (\d+) characters$/.exec(msg);
    if (m) return { k: m[1] === "least" ? "account.err.pwMin" : "account.err.pwMax", v: { n: m[2] } };
    return null;
  }

  // A message "spec" is a key string, {k, v} or {raw}; resolve() turns it into text now.
  function resolve(spec) {
    if (spec == null || spec === "") return "";
    if (typeof spec === "string") return t(spec);
    if (spec.raw != null) return String(spec.raw);
    if (spec.k) {
      var v = {};
      if (spec.v) for (var k in spec.v) if (Object.prototype.hasOwnProperty.call(spec.v, k)) v[k] = resolve(spec.v[k]);
      if (spec.plural) return plural(spec.k, spec.n, v);
      return t(spec.k, v);
    }
    if (spec.fn) return String(spec.fn());
    return "";
  }

  // Element registry: text/attributes set from specs are re-resolved on a language change.
  var reg = [];
  function track(el) { if (!el.__mxTracked) { el.__mxTracked = true; reg.push(el); } }
  function setText(el, spec) {
    if (!el) return;
    el.__mxText = spec;
    el.textContent = resolve(spec);
    track(el);
  }
  function setAttr(el, attr, spec) {
    if (!el) return;
    if (!el.__mxAttrs) el.__mxAttrs = {};
    el.__mxAttrs[attr] = spec;
    el.setAttribute(attr, resolve(spec));
    track(el);
  }
  function refresh() {
    for (var i = 0; i < reg.length; i++) {
      var el = reg[i];
      if ("__mxText" in el) el.textContent = resolve(el.__mxText);
      if (el.__mxAttrs) for (var a in el.__mxAttrs) if (Object.prototype.hasOwnProperty.call(el.__mxAttrs, a)) el.setAttribute(a, resolve(el.__mxAttrs[a]));
    }
    // Drop elements that left the document so the list doesn't grow forever.
    reg = reg.filter(function (el) { if (document.contains(el)) return true; el.__mxTracked = false; return false; });
  }

  function onLang(cb) {
    // The core fires "medindex:lang" on document after setLang().
    document.addEventListener("medindex:lang", function () { refresh(); cb(); });
  }

  // Specialty display names come from js/i18n-specialties.js ("spec.<English name>").
  function specialty(name) {
    if (!name) return "";
    var key = "spec." + name;
    var s = I18N && I18N.t ? I18N.t(key) : key;
    return !s || s === key ? String(name) : s;
  }

  window.MedIndexAccountI18n = {
    en: EN, ro: RO,
    lang: lang, t: t, has: has, plural: plural, resolve: resolve,
    formatNumber: formatNumber, formatDate: formatDate, formatBytes: formatBytes,
    errorKey: errorKey, setText: setText, setAttr: setAttr, refresh: refresh, onLang: onLang,
    specialty: specialty
  };
})();
