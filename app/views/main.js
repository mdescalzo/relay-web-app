/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};
    window.F = window.F || {};

    var SocketView = Whisper.View.extend({
        className: 'status',
        initialize: function() {
            setInterval(this.updateStatus.bind(this), 5000);
        },
        updateStatus: function() {
            var className, message = '';
            if (typeof getSocketStatus === 'function') {
              switch(getSocketStatus()) {
                  case WebSocket.CONNECTING:
                      className = 'connecting';
                      break;
                  case WebSocket.OPEN:
                      className = 'open';
                      break;
                  case WebSocket.CLOSING:
                      className = 'closing';
                      break;
                  case WebSocket.CLOSED:
                      className = 'closed';
                      message = i18n('disconnected');
                      break;
              }
            if (!this.$el.hasClass(className)) {
                this.$el.attr('class', className);
                this.$el.text(message);
            }
          }
        }
    });

    F.ConversationStack = F.View.extend({
        className: 'conversation-stack',

        open: function(conversation) {
            let $convo = this.$(`#conversation-${conversation.cid}`);
            if (!$convo.length) {
                $convo = (new F.ConversationView({model: conversation})).$el;
            }
            this.$el.prepend($convo);
            conversation.trigger('opened');
        }
    });

    F.MainView = F.View.extend({
        el: 'body',

        initialize: function(options) {
            const inboxCollection = getInboxCollection();
            const pending = [];

            this.orgView = new F.View({
                templateName: 'f-article-org',
                el: '#f-article-org-view'
            }).render();

            pending.push(F.ccsm.getUserProfile().then(user => {
                this.headerView = new F.HeaderView({
                    el: '#f-header-menu-view',
                    model: new Backbone.Model(user)
                }).render();
            }));

            this.conversationStack = new F.ConversationStack({
                el: '#f-article-conversation-stack'
            }).render();

            this.navConversationView = new F.NavConversationView({
                el: '#f-nav-conversation-view',
                collection: inboxCollection
            }).render();

            this.navPinnedView = new F.NavConversationView({
                el: '#f-nav-pinned-view',
                templateName: 'f-nav-pinned',
                collection: inboxCollection
            }).render();

            this.navAnnouncementView = new F.NavConversationView({
                el: '#f-nav-announcements-view',
                templateName: 'f-nav-announcements',
                collection: inboxCollection
            }).render();

            this.navConversationView.listenTo(inboxCollection,
                'add change:timestamp change:name change:number',
                this.navConversationView.sort);

            this.searchView = new Whisper.ConversationSearchView({
                el: this.$('.search-results'),
                input: this.$('input.search')
            });

            this.searchView.$el.hide();

            this.listenTo(this.searchView, 'hide', function() {
                this.searchView.$el.hide();
                this.navConversationView.$el.show();
            });
            this.listenTo(this.searchView, 'show', function() {
                this.searchView.$el.show();
                this.navConversationView.$el.hide();
            });
            this.listenTo(this.searchView, 'open',
                this.openConversation.bind(this, null));

            new SocketView().render().$el.appendTo(this.$('.socket-status'));

            this.openMostRecentConversation();

            Promise.all(pending).then(() => {
                $('body > .ui.dimmer').removeClass('active');
            });
        },

        events: {
            'click nav table thead': 'toggleNavSection',
            'click a.toggle-nav-vis': 'toggleNavBar',
            'select nav .conversation-item': 'openConversation',
            'input input.search': 'filterContacts',
            'show .lightbox': 'showLightbox'
        },

        toggleNavBar: function(e) {
            const nav = $('nav');
            const app_toggle = $('article a.toggle-nav-vis');
            if (nav.width()) {
                app_toggle.fadeIn();
                nav.width(0);
            } else {
                app_toggle.fadeOut();
                nav.width(350); // XXX
            }
        },

        toggleNavSection: function(e) {
            const el = $(e.currentTarget);
            const body = el.next('tbody');
            body.toggle();
        },

        filterContacts: function(e) {
            this.searchView.filterContacts(e);
            var input = this.$('input.search');
            if (input.val().length > 0) {
                input.addClass('active');
            } else {
                input.removeClass('active');
            }
        },

        openConversation: function(e, convo) {
            this.searchView.hideHints();
            this.conversationStack.open(ConversationController.create(convo));
            storage.put('most-recent-conversation', convo.id);
        },

        openMostRecentConversation: function() {
            const cid = storage.get('most-recent-conversation');
            if (!cid) {
                return;
            }
            const convo = getInboxCollection().get(cid);
            this.conversationStack.open(ConversationController.create(convo));
        },

        showLightbox: function(e) {
            this.$el.append(e.target);
        }
    });
})();
