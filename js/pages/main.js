import { _supabase } from '../config.js';
import '../widgets.js';
import '../global.js';

window.myProfile = null;

/**
 * Отрисовка интерфейса для авторизованного пилота
 */
function showLoggedIn(profile) {
  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const nick = document.getElementById('displayNick');
  const notifyWrapper = document.getElementById('notifyWrapper');

  if (loginBtn) loginBtn.style.display = 'none';
  if (userInfo) userInfo.style.display = 'flex';
  if (notifyWrapper) notifyWrapper.style.display = 'flex';

  if (nick) {
    nick.innerText = profile.username;
    nick.className = profile.is_admin ? 'admin-glow' : '';
    nick.style.color = '#fff';
  }
}

/**
 * Отрисовка интерфейса для гостя
 */
function showGuestView() {
  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const nick = document.getElementById('displayNick');
  const notifyWrapper = document.getElementById('notifyWrapper');

  if (loginBtn) {
    loginBtn.style.display = 'inline-block';
    // Если loginBtn это ссылка, проверяем переход на auth.html
    if (loginBtn.tagName === 'A') {
      loginBtn.href = 'auth.html';
    }
  }

  if (userInfo) userInfo.style.display = 'none';

  if (nick) {
    nick.innerText = 'GUEST';
    nick.className = '';
    nick.style.color = '#888';
  }

  // Оставляем колокольчик видимым (при клике сработает заглушка из global.js)
  // или можно скрыть: notifyWrapper.style.display = 'none';
  if (notifyWrapper) notifyWrapper.style.display = 'flex';
}

// ==================== ІНІЦІАЛІЗАЦІЯ СТОРІНКИ ====================
const initPage = async () => {
  if (typeof applyLanguage === 'function') applyLanguage();

  const { data: { user } } = await _supabase.auth.getUser();

  if (user) {
    // 1. АВТОРИЗОВАНИЙ ГОНЩИК
    window.currentUserId = user.id;

    const { data: profile } = await _supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profile) {
      profile.isGuest = false;
      window.myProfile = profile;

      const savedStatus = localStorage.getItem('driver_status') || profile.status || 'ONLINE';
      window.myProfile.status = savedStatus;

      showLoggedIn(profile);

      if (typeof window.initGlobalStatus === 'function') {
        window.initGlobalStatus(_supabase, window.myProfile);
      }

      if (typeof window.updateGlobalMsgBadge === 'function') window.updateGlobalMsgBadge(_supabase, window.myProfile.id);
      if (typeof window.updateFriendNotifications === 'function') window.updateFriendNotifications();
      if (typeof window.checkAdminReplies === 'function') window.checkAdminReplies();

      // Realtime події для особистих повідомлень
      _supabase.channel('index-realtime')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `receiver_id=eq.${window.myProfile.id}`
        }, () => {
          if (typeof window.updateGlobalMsgBadge === 'function') window.updateGlobalMsgBadge(_supabase, window.myProfile.id);
          if (typeof window.playNotificationSound === 'function') window.playNotificationSound();
        })
        .subscribe();

      // Realtime події для тикетів підтримки
      _supabase.channel('support-realtime')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_tickets',
          filter: `user_id=eq.${window.myProfile.id}`
        }, (payload) => {
          if (typeof window.checkAdminReplies === 'function') window.checkAdminReplies();
          if (payload.new.status === 'resolved' && !payload.new.is_read) {
            if (typeof window.playNotificationSound === 'function') window.playNotificationSound();
          }
        })
        .subscribe();
    }
  } else {
    // 2. ГОСТЕВИЙ РЕЖИМ
    window.currentUserId = null;
    window.myProfile = {
      id: null,
      username: 'Guest_' + Math.random().toString(36).substring(2, 6),
      isGuest: true,
      status: 'GUEST',
      avatar_url: 'https://via.placeholder.com/34?text=G'
    };

    showGuestView();

    if (typeof window.initGlobalStatus === 'function') {
      window.initGlobalStatus(_supabase, null);
    }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
