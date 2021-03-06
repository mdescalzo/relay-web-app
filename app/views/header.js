 // vim: ts=4:sw=4:expandtab
 /* global moment */

(function () {
    'use strict';

    self.F = self.F || {};

    const searchFromRe = /from:\s?"(.*?)"|from:\s?'(.*?)'|from:\s?([^\s]+)/i;
    const searchToRe = /to:\s?"(.*?)"|to:\s?'(.*?)'|to:\s?([^\s]+)/i;
            
    F.HeaderView = F.View.extend({
        template: 'views/header.html',

        initialize: function() {
            F.View.prototype.initialize.apply(this, arguments);
            this.on('select-logout', this.onLogoutSelect);
            this.on('select-devices', this.onDevicesSelect);
            this.on('select-import-contacts', this.onImportContactsSelect);
            this.on('select-settings', this.onSettingsSelect);
            $('body').on('click', 'button.f-delete-device', this.onDeleteClick); // XXX move to it's own view
            this.messageSearchResults = new F.MessageCollection();
            this._onBodyClick = this.onBodyClick.bind(this);
        },

        events: {
            'click .f-toc': 'onTOCClick',
            'click .f-toc-menu .item[data-item]': 'onDataItemClick',
            'click .f-toc-menu .link': 'onLinkClick',
            'click .f-toc-menu a': 'onLinkClick',
            'click .f-search .ui.input .icon': 'onSearchClick',
            'blur .f-search .ui.input': 'onSearchBlur'
        },

        render_attributes: async function() {
            const isMainSite = !!F.mainView;
            return Object.assign({
                showSettings: isMainSite,
                showImportContacts: isMainSite,
                name: this.model.getName(),
                tagSlug: this.model.getTagSlug(/*forceFull*/ true),
                orgAttrs: (await this.model.getOrg()).attributes,
                avatar: await this.model.getAvatar({nolink: true}),
                admin: this.model.get('permissions').indexOf('org.administrator') !== -1
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            await this.updateAttention();
            this.$tocMenu = this.$('.f-toc-menu');
            this.$search = this.$('.f-search .ui.search');
            this.uiSearch = this.$search.search.bind(this.$search);
            this.uiSearch({
                type: 'category',
                source: [], // Prevent attempts to use API
                searchDelay: 400,
                cache: false,
                showNoResults: false,
                maxResults: 0,
                onSearchQuery: this.onSearchQuery.bind(this),
                onSelect: this.onSearchSelect.bind(this),
                onResultsAdd: html => !!html,  // Workaround local search empty results...
                verbose: true,
                selector: {
                    result: '.f-result'
                }
            });
            this.$search.find('.prompt').on('keydown', ev => {
                if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
                    requestAnimationFrame(() => {
                        const active = this.$search.find('.active')[0];
                        if (active) {
                            active.scrollIntoView({block: 'nearest'});
                        }
                    });
                }
            });
            return this;
        },

        onSearchBlur: function() {
            // XXX Debounce blur by click with timing hack...
            this.lastBlur = Date.now();
        },

        onSearchClick: function() {
            if (this.uiSearch('is focused')) {
                this.$('.f-search input').blur();
            } else if (Date.now() - (this.lastBlur || 0) > 100) {
                this.$('.f-search input').focus();
            }
        },

        onSearchQuery: async function(query) {
            if (query.length < 3) {
                this.uiSearch('display message', 'Need more input...');
                return;
            }
            this.uiSearch('set loading');
            try {
                await this._onSearchQuery(query);
            } finally {
                this.uiSearch('remove loading');
            }
        },


        _onSearchQuery: async function(query) {
            const fetchTemplate = F.tpl.fetch(F.urls.templates + 'util/search-results.html');
            const msgResults = this.messageSearchResults;
            const fromMatch = searchFromRe.exec(query);
            const criteria = [];
            if (fromMatch) {
                query = query.substr(0, fromMatch.index) +
                        query.substr(fromMatch.index + fromMatch[0].length);
                criteria.push({
                    index: 'from-ngrams',
                    criteria: fromMatch.slice(1).filter(x => x)[0]
                });
            }
            const toMatch = searchToRe.exec(query);
            if (toMatch) {
                query = query.substr(0, toMatch.index) +
                        query.substr(toMatch.index + toMatch[0].length);
                criteria.push({
                    index: 'to-ngrams',
                    criteria: toMatch.slice(1).filter(x => x)[0]
                });
            }
            const queryWords = query.split(/\s+/).map(x => x.toLowerCase()).filter(x => x);
            criteria.push({
                index: 'body-ngrams',
                criteria: query
            });
            console.debug("Search criteria:", criteria);
            const searchJob = msgResults.searchFetch(criteria, {
                sort: (a, b) => (b.sent || 0) - (a.sent || 0),
                filter: x => x.threadId && F.foundation.allThreads.get(x.threadId)
            });
            /* Look for near perfect contact matches. */
            const contactResults = queryWords.length ? F.foundation.getContacts().filter(c => {
                const names = ['first_name', 'last_name'].map(
                    x => (c.get(x) || '').toLowerCase()).filter(x => x);
                return queryWords.every(w => names.some(n => n.startsWith(w)));
            }) : [];
            await searchJob;
            if (!msgResults.length && !contactResults.length) {
                this.uiSearch('display message', 'No matching messages or contacts found.', 'empty');
                return;
            }
            const messages = (await Promise.all(msgResults.map(async m => {
                if (m.get('type') === 'clientOnly') {
                    return;
                }
                const sender = await m.getSender();
                if (!sender) {
                    console.warn("Skipping message without sender:", m);
                    return;
                }
                const thread = m.getThread();
                if (!thread) {
                    console.warn("Skipping message from archived thread:", m);
                    return;
                }
                return {
                    id: m.id,
                    senderName: sender.getName(),
                    threadTitle: thread.getNormalizedTitle(/*text*/ true),
                    avatarProps: await sender.getAvatar({nolink: true}),
                    sent: m.get('sent'),
                    plain: m.get('plain')
                };
            }))).filter(x => x);
            const contacts = await Promise.all(contactResults.map(async c => ({
                id: c.id,
                name: c.getName(),
                avatarProps: await c.getAvatar({nolink: true})
            })));
            this.uiSearch('add results', (await fetchTemplate)({
                messages,
                contacts
            }));
            requestAnimationFrame(() => {
                this.$search.find('.results').scrollTop(0);
            });
        },

        onSearchSelect: function(result) {
            const [type, id] = result.split(':');
            if (type === 'MESSAGE') {
                this.showMessage(this.messageSearchResults.get(id));
            } else if (type === 'CONTACT') {
                const $anchor = this.$(`.f-result[data-result="${result}"] .f-avatar`);
                F.util.showUserCard(id, $anchor);
                return false;  // Leave open and don't do anyting else.
            }
        },

        showMessage: async function(message) {
            const thread = message.getThread();
            await thread.messages.fetchToReceived(message.get('received'));
            if (!F.mainView.isThreadOpen(thread)) {
                await F.mainView.openThread(thread);
            } else if (F.util.isSmallScreen()) {
                // The nav bar may be obscuring the message pane if we're currently
                // selected on this thread and it's open.
                F.mainView.toggleNavBar(/*collapse*/ true);
            }
            const threadView = F.mainView.threadStack.get(thread);
            const threadType = thread.get('type');
            if (threadType === 'conversation') {
                const msgItem = threadView.msgView.getItem(message);
                msgItem.$el.siblings().removeClass('search-match');
                msgItem.$el.addClass('search-match');
                requestAnimationFrame(() => {
                    threadView.msgView.unpin();
                    msgItem.el.scrollIntoView({behavior: 'smooth'});
                    msgItem.$el.transition('pulse');
                });
            } else if (threadType !== 'announcement') {
                console.error("Invalid thread type:", thread);
                throw new TypeError("Invalid thread type");
            }
        },

        updateAttention: async function() {
            const unreadCount = this.unread !== undefined ? this.unread :
                await F.state.get('unreadCount');
            const navCollapsed = this.navCollapsed !== undefined ? this.navCollapsed :
                await F.state.get('navCollapsed');
            const needAttention = !!(unreadCount && navCollapsed);
            const needFlash = this._lastUnreadCount !== undefined &&
                              this._lastUnreadCount !== unreadCount;
            this._lastUnreadCount = unreadCount;
            const $btn = this.$('.f-toggle-nav.button');
            $btn.toggleClass('attention', needAttention);
            if (needAttention) {
                $btn.attr('title', `${unreadCount} unread messages`);
                if (needFlash) {
                    navigator.vibrate && navigator.vibrate(200);
                    $btn.transition('pulse');
                }
            } else {
                $btn.attr('title', `Toggle navigation view`);
            }
        },

        updateUnreadCount: function(unread) {
            this.unread = unread;
            this.updateAttention();  // bg okay
        },

        updateNavCollapseState: function(collapsed) {
            this.navCollapsed = collapsed;
            this.updateAttention();  // bg okay
        },

        onTOCClick: function(ev) {
            ev.stopPropagation();  // Prevent clickaway detection from processing this.
            if (this.$tocMenu.hasClass('visible')) {
                this.hideTOC();
            } else {
                this.showTOC();
            }
        },

        hideTOC: function() {
            $('body').off('click', this._onBodyClick);
            this.$tocMenu.removeClass('visible');
        },

        showTOC: function() {
            this.$tocMenu.addClass('visible');
            $('body').on('click', this._onBodyClick);
        },

        onDataItemClick: function(ev) {
            const item = ev.currentTarget.dataset.item;
            if (item) {
                this.trigger(`select-${item}`);
            } else {
                console.warn("Bad toc menu item", ev.currentTarget);
            }
        },

        onLinkClick: function() {
            this.hideTOC();
        },

        onBodyClick: function(ev) {
            /* Detect clickaway */
            if (!$(ev.target).closest(this.$tocMenu).length) {
                this.hideTOC();
            }
        },

        onLogoutSelect: async function(e) {
            await F.util.confirmModal({
                icon: 'sign out',
                header: 'Logout from Forsta?',
                size: 'tiny',
                confirmClass: 'red'
            }) && await F.atlas.logout();
        },

        onDevicesSelect: async function(e) {
            const devices = await F.atlas.getDevices();
            const content = [
                '<table class="f-linked-devices">',
                    '<thead><tr>',
                        '<th>ID</th><th>Description</th><th>Created</th><th></th>',
                    '</tr></thead>'
            ];
            const dayMS = 86400 * 1000;
            const todayMS = Math.floor(Date.now() / dayMS) * dayMS;
            devices.sort((a, b) => {
                if (a.lastSeen === b.lastSeen) {
                    return a.created > b.created ? 0.1 : -0.1;
                } else {
                    return a.lastSeen < b.lastSeen ? 1 : -1;
                }
            });
            const blueCircle = ' <i class="icon circle small blue" title="This computer"></i>';
            for (const x of devices) {
                const lastSeenAgo = Math.max(todayMS - x.lastSeen, 0);
                const lastSeen = lastSeenAgo < dayMS * 1.5 ? 'Today' :
                    moment.duration(-lastSeenAgo).humanize(/*suffix*/ true);
                const us = Number(x.id) === F.currentDevice ? blueCircle : '';
                content.push([
                    '<tr>',
                        `<td><samp>${x.id}</samp>${us}</td>`,
                        `<td>${x.name}<br/><small>Last seen ${lastSeen}</small></td>`,
                        `<td><small>${moment(x.created).calendar()}</small></td>`,
                        '<td>',
                            `<button data-id="${x.id}" data-name="${x.name}" `,
                                    `data-last-seen="${lastSeen}" `,
                                    'title="Delete Device" ',
                                    'class="f-delete-device ui button basic mini negative icon">',
                                '<i class="icon trash"></i>',
                            '</button>',
                        '</td>',
                    '</tr>'
                ].join(''));
            }
            content.push('</table>');
            await F.util.promptModal({
                icon: 'microchip',
                header: 'Linked Devices',
                content: content.join('')
            });
        },

        onImportContactsSelect: async function(e) {
            await (new F.ImportContactsView()).show();
        },

        onSettingsSelect: async function(e) {
            await (new F.SettingsView()).show();
        },

        onDeleteClick: async function(ev) {
            const id = this.dataset.id;
            const name = this.dataset.name;
            const lastSeen = this.dataset.lastSeen;
            if (await F.util.confirmModal({
                icon: 'trash',
                header: `Delete device #${id}?`,
                content: `Do you really want to delete the device: <q><samp>${name}</samp></q>?`,
                footer: 'This device was last seen: ' + lastSeen,
                confirmClass: 'red'
            })) {
                const am = await F.foundation.getAccountManager();
                try {
                    await am.deleteDevice(id);
                } catch(e) {
                    F.util.promptModal({
                        icon: 'warning circle red',
                        header: `Error deleting device #${id}`,
                        content: e
                    });
                    throw e;
                }
            }
        }
    });
})();
