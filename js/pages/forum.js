import { _supabase } from '../config.js';
import '../widgets.js';
import '../global.js';

let myProfile = null;
let isCreatingTopic = false;

// Вспомогательная функция для защиты от XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.onload = async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  if (user) {
    // 1. АВТОРИЗОВАННЫЙ ПОЛЬЗОВАТЕЛЬ
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', user.id).single();

    if (profile) {
      profile.isGuest = false;
      myProfile = profile;
      window.myProfile = profile;
      window.currentUserId = user.id;

      const nickEl = document.getElementById('displayNick');
      if (nickEl) nickEl.innerText = myProfile.username;

      if (typeof updateFriendNotifications === 'function') updateFriendNotifications();
      if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, myProfile);
      if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, myProfile.id);
      if (typeof checkAdminReplies === 'function') checkAdminReplies();

      // Слушатели только для авторизованного пользователя
      _supabase.channel('forum-msg-updates')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `receiver_id=eq.${user.id}`
        }, () => {
          if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, user.id);
        })
        .subscribe();

      _supabase.channel('support-realtime')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_tickets',
          filter: `user_id=eq.${myProfile.id}`
        }, (payload) => {
          if (typeof checkAdminReplies === 'function') checkAdminReplies();
          if (payload.new.status === 'resolved' && !payload.new.is_read) {
            if (typeof playNotificationSound === 'function') playNotificationSound();
          }
        })
        .subscribe();
    }
  } else {
    // 2. ГОСТЕВОЙ РЕЖИМ (не выгоняем, разрешаем чтение)
    myProfile = {
      id: null,
      username: 'Guest_' + Math.random().toString(36).substring(2, 6),
      isGuest: true,
      status: 'GUEST',
      avatar_url: 'https://via.placeholder.com/34?text=G'
    };
    window.myProfile = myProfile;
    window.currentUserId = null;

    const nickEl = document.getElementById('displayNick');
    if (nickEl) {
      nickEl.innerText = 'GUEST';
      nickEl.style.color = '#888';
    }

    if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, null);

    // Блокируем форму создания тем для гостей
    lockNewTopicFormForGuest();
  }

  // Загружаем список тем форума (доступно всем)
  await loadTopics();
};

/**
 * Блокировка полей создания новой темы для гостя
 */
function lockNewTopicFormForGuest() {
  const titleInput = document.getElementById('topicTitle');
  const contentInput = document.getElementById('topicContent');
  const createBtn = document.querySelector('button[onclick="createNewTopic()"]') ||
    document.querySelector('.create-topic-btn');

  if (titleInput) {
    titleInput.disabled = true;
    titleInput.placeholder = 'Only authorized racers can start new topics...';
    titleInput.style.backgroundColor = '#141414';
    titleInput.style.cursor = 'not-allowed';
  }

  if (contentInput) {
    contentInput.disabled = true;
    contentInput.placeholder = 'Log in to participate in club discussions.';
    contentInput.style.backgroundColor = '#141414';
    contentInput.style.cursor = 'not-allowed';
  }

  if (createBtn) {
    createBtn.disabled = true;
    createBtn.style.opacity = '0.5';
    createBtn.style.cursor = 'not-allowed';
    createBtn.title = 'Authorization required';
  }
}

async function loadTopics() {
  const { data, error } = await _supabase
    .from('forum_topics')
    .select('*')
    .order('created_at', { ascending: false });

  const list = document.getElementById('topicsList');
  if (!list) return;
  list.innerHTML = '';

  if (error) {
    console.error('Error loading topics:', error);
    return;
  }

  if (data && data.length > 0) {
    data.forEach(topic => {
      const date = new Date(topic.created_at).toLocaleDateString();
      const rawContent = topic.content || '';
      const previewText = rawContent.length > 120 ? rawContent.substring(0, 120) + '...' : rawContent;

      list.innerHTML += `
        <div class="topic-card" onclick="window.location.href='topic.html?id=${topic.id}'">
          <div class="topic-title">${escapeHtml(topic.title)}</div>
          <div class="user-text-content" style="margin-bottom: 10px;">${escapeHtml(previewText)}</div>
          <div style="font-size: 0.8rem; color: #777; font-family: 'Arial', 'Helvetica', sans-serif !important;">
            Author: <strong style="color: #aaa;">${escapeHtml(topic.author_name)}</strong> • ${date}
          </div>
        </div>
      `;
    });
  } else {
    list.innerHTML = '<p style="color: #666; font-size: 0.85rem; padding: 20px 0;">No topics created yet.</p>';
  }
}

window.createNewTopic = async () => {
  // Защита от гостей
  if (!myProfile || myProfile.isGuest) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to create forum topics.");
    } else {
      alert("You must be logged in to create a topic.");
    }
    return;
  }

  if (isCreatingTopic) return;

  // Проверка мута
  if (myProfile.muted_until && new Date(myProfile.muted_until) > new Date()) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'MUTED',
        text: 'You are muted and cannot create new topics.',
        icon: 'error',
        customClass: { popup: 'nfs-crt-modal' }
      });
    } else {
      alert('You are muted and cannot create new topics.');
    }
    return;
  }

  const titleInput = document.getElementById('topicTitle');
  const contentInput = document.getElementById('topicContent');
  const title = titleInput?.value.trim();
  const content = contentInput?.value.trim();

  if (!title || !content) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'WARNING',
        text: 'Please fill in both title and content.',
        icon: 'warning',
        customClass: { popup: 'nfs-crt-modal' }
      });
    } else {
      alert('Please fill in both title and content.');
    }
    return;
  }

  isCreatingTopic = true;

  try {
    const { data, error } = await _supabase
      .from('forum_topics')
      .insert([{
        title,
        content,
        author_name: myProfile.username,
        author_id: myProfile.id,
        category: 'game'
      }])
      .select('id')
      .single();

    if (error) throw error;

    // Мгновенный переход внутрь созданной темы
    if (data?.id) {
      window.location.href = `topic.html?id=${data.id}`;
    } else {
      if (titleInput) titleInput.value = '';
      if (contentInput) contentInput.value = '';
      await loadTopics();
    }
  } catch (err) {
    console.error('Failed to create topic:', err);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'ERROR',
        text: 'Failed to create topic: ' + err.message,
        icon: 'error',
        customClass: { popup: 'nfs-crt-modal' }
      });
    } else {
      alert('Failed to create topic: ' + err.message);
    }
  } finally {
    isCreatingTopic = false;
  }
};
