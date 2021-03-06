// vim: ts=4:sw=4:expandtab
/* global firebase md5 Backbone relay */

(function() {
    'use strict';

    self.F = self.F || {};

    var SETTINGS = {
        OFF     : 'off',
        COUNT   : 'count',
        NAME    : 'name',
        MESSAGE : 'message'
    };

    F.notifications = new (Backbone.Collection.extend({
        initialize: function() {
            this.on('add', this.onAdd);
            this.on('remove', this.onRemove);
            if (self.registration && self.clients) {
                addEventListener('notificationclick', this.onClickHandler.bind(this));
                this.worker = true;
            } else {
                this.worker = false;
            }
        },

        havePermission: function() {
            return self.Notification && Notification.permission === 'granted';
        },

        onAdd: async function(model, collection, options) {
            const message = model.get('message');
            const setting = await F.state.get('notificationSetting') || 'message';
            const filters = await F.state.get('notificationFilter') || [];
            let worthy = true;
            if (filters.length) {
                worthy = false;
                for (const x of filters) {
                    if (x === 'mention') {
                        const mentions = message.get('mentions') || [];
                        if (mentions.indexOf(F.currentUser.id) !== -1) {
                            worthy = true;
                            break;
                        }
                    } else if (x === 'name') {
                        const msgText = (message.get('plain') || '').toLowerCase();
                        const fName = (F.currentUser.get('first_name') || '').toLowerCase();
                        const lName = (F.currentUser.get('last_name') || '').toLowerCase();
                        if (msgText.indexOf(fName) + msgText.indexOf(lName) !== -2) {
                            worthy = true;
                            break;
                        }
                    } else if (x === 'dm') {
                        if (message.get('members').length === 2) {
                            worthy = true;
                            break;
                        }
                    }
                }
            }
            if (setting === SETTINGS.OFF || !this.havePermission() || !worthy) {
                console.warn("Notification muted:", message);
                return;
            }

            // Alert state needs to be pre debounce.
            const shouldAlert = this.where({threadId: message.get('threadId')}).length == 1;
            await relay.util.sleep(2);  // Allow time for read receipts
            if (!this.isValid(model)) {
                return; // 1 of 2  (avoid work)
            }
            let title;
            const note = {
                icon: F.util.versionedURL(F.urls.static + 'images/icon_128.png'),
                tag: 'forsta'
            };
            if (setting === SETTINGS.COUNT) {
                title = [
                    this.length,
                    this.length === 1 ? 'New Message' : 'New Messages'
                ].join(' ');
            } else {
                const sender = await message.getSender();
                title = sender.getName();
                note.tag = message.get('threadId');
                note.icon = await sender.getAvatarURL();
                note.image = await message.getAttachmentPreview();
                if (setting === SETTINGS.NAME) {
                    note.body = 'New Message';
                } else if (setting === SETTINGS.MESSAGE) {
                    note.body = message.getNotificationText();
                } else {
                    throw new Error("Invalid setting");
                }
            }
            note.requireInteraction = true;
            /* Do final dedup checks after all async calls to avoid races. */
            if (!this.isValid(model.id)) {
                return; // 2 of 2  (avoid async races)
            }
            if (shouldAlert && !(await F.state.get('notificationSoundMuted'))) {
                await F.util.playAudio('audio/new-notification.wav');
            }
            /* Prefer using service worker based notifications for both contexts.  It's a
             * more robust API and works on mobile android. */
            const swReg = this.getSWReg();
            if (swReg) {
                await swReg.showNotification(title, note);
            } else {
                const n = new Notification(title, note);
                n.addEventListener('click', this.onClickHandler.bind(this));
                n.addEventListener('show', this.onShowHandler.bind(this, model.id));
                model.set("note", n);
            }
        },

        getSWReg: function() {
            return self.registration || (F.serviceWorkerManager &&
                                         F.serviceWorkerManager.getRegistration());
        },

        isValid: function(id) {
            /* True if the message has not been read yet. */
            return !!this.get(id);
        },

        onClickHandler: function(ev) {
            if (this.worker) {
                ev.waitUntil(this.onClick(ev.notification));
            } else {
                this.onClick(ev.target);
            }
        },

        onShowHandler: function(id, ev) {
            /* Handle race conditions related to notification rendering. */
            if (!this.isValid(id)) {
                ev.target.close();
            }
        },

        onClick: async function(note) {
            note.close();
            if (this.worker) {
                const wins = await F.activeWindows();
                const url = `${F.urls.main}/${note.tag}`;
                if (!wins.length) {
                    console.info("Opening fresh window from notification");
                    await self.clients.openWindow(url);
                } else {
                    console.info("Focus existing window from notification");
                    /* The order is based on last focus for modern browsers */
                    await wins[0].focus();
                    wins[0].postMessage({
                        op: 'openThread',
                        data: {
                            threadId: note.tag
                        }
                    });
                }
            } else {
                parent.focus();
                F.mainView.openThreadById(note.tag);
            }
            this.remove(this.where({threadId: note.tag}));
        },

        onRemove: async function(model, collection, options) {
            const note = model.get('note');
            if (note) {
                note.close();
            } else {
                const swReg = this.getSWReg();
                if (swReg) {
                    const notes = await swReg.getNotifications({tag: model.get('threadId')});
                    for (const n of notes) {
                        n.close();
                    }
                }
            }
        }
    }))();

    F.BackgroundNotificationService = class BackgroundNotificationService {

        async start() {
            if (!('serviceWorker' in navigator && F.env.FIREBASE_CONFIG)) {
                return false;
            }
            const fb = firebase.initializeApp(F.env.FIREBASE_CONFIG,
                                              'push-notifications-' + F.currentUser.id);
            this.fbm = firebase.messaging(fb);
            F.serviceWorkerManager.addEventListener('bindregistration', this.bindFbm.bind(this));
            const reg = F.serviceWorkerManager.getRegistration();
            if (reg) {
                await this.bindFbm(reg);
            }
        }

        async bindFbm(reg) {
            console.info("Firebase messaging using:", reg);
            this.fbm.useServiceWorker(reg);
            await this.setupToken();
        }

        async isKnownToken(token) {
            /* Check if server has the token in question. */
            const curHash = await F.state.get('serverGcmHash');
            return curHash === md5(token);
        }

        async saveKnownToken(token) {
            if (token) {
                await F.state.put('serverGcmHash', md5(token));
            } else {
                await F.state.remove('serverGcmHash');
            }
        }

        async shareTokenWithSignal(token) {
            console.info("Updating GCM Registration ID");
            const am = await F.foundation.getAccountManager();
            try {
                await am.signal.updateGcmRegistrationId(token);
            } catch(e) {
                await this.saveKnownToken(null);
                throw e;
            }
            await this.saveKnownToken(token);
        }

        async setupToken() {
            /* Loads or creates a messaging token used by Signal server to find us.
             * Also establishes a monitor in case the token changes. */
            const token = await this.fbm.getToken();
            if (token) {
                if (!(await this.isKnownToken(token))) {
                    await this.shareTokenWithSignal(token);
                }
            } else {
                throw new Error("Did not get token for FBM; Permissions granted?");
            }
            this.fbm.onTokenRefresh(async function() {
                console.info('Firebase messaging token refreshed.');
                await this.shareTokenWithSignal(await this.fbm.getToken());
            });
        }
    };
})();
