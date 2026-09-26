// js/global.js
import { _supabase } from './config.js';

window.currentActiveTicketId = null;

/**
 * Розрахунок відносного часу створення сповіщення
 */
function getRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Оновлення лічильника непрочитаних повідомлень
 */
window.updateGlobalMsgBadge = async function(supabaseClient, myId) {
  const client = supabaseClient || _supabase;
  if (!client || !myId) return;

  const { count, error } = await client
    .from('direct_messages')
    .select('*', { count: 'exact', head: true })
    .eq('receiver_id', myId)
    .eq('is_read', false);

  const badge = document.getElementById('msgBadge');
  if (badge) {
    if (!error && count > 0) {
      badge.innerText = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
};

/**
 * Вихід з акаунту
 */
window.handleLogout = async function() {
  const user = window.myProfile || window.currentUserId;
  const userId = typeof user === 'object' ? user?.id : user;

  if (userId && typeof _supabase !== 'undefined' && !user?.isGuest) {
    await _supabase.from('profiles').update({ status: 'OFFLINE' }).eq('id', userId);
  }
  if (typeof _supabase !== 'undefined') {
    await _supabase.auth.signOut();
  }
  localStorage.removeItem('driver_status');
  window.location.href = 'auth.html';
};

/**
 * Перемикання списку сповіщень
 */
window.toggleNotifyPopup = function() {
  const p = document.getElementById('notifyPopup');
  if (!p) return;

  const isGuest = !window.myProfile || window.myProfile.isGuest === true;
  if (isGuest) {
    const listEl = document.getElementById('notifyList');
    if (listEl) {
      listEl.innerHTML = `
        <div style="padding:15px; font-size:11px; color:#888; text-align:center; line-height: 1.4;">
          Notifications are only available for authorized drivers.<br>
          <a href="auth.html" style="color:#f1c40f; text-decoration:none; font-weight:bold; display:inline-block; margin-top:8px;">LOG IN</a>
        </div>`;
    }
    p.style.display = p.style.display === 'block' ? 'none' : 'block';
    return;
  }

  p.style.display = p.style.display === 'block' ? 'none' : 'block';
};

/**
 * Оновлення сповіщень (заявки в друзі + відповіді на форумі)
 */
window.updateFriendNotifications = async function() {
  if (typeof _supabase === 'undefined') return;

  if (window.myProfile?.isGuest) return;

  let currentId = window.myProfile?.id || window.currentUserId;
  if (!currentId) {
    const { data: { user } } = await _supabase.auth.getUser();
    if (user) {
      currentId = user.id;
      window.currentUserId = user.id;
    }
  }

  if (!currentId) return;

  const { data: notifications, error } = await _supabase
    .from('notifications')
    .select('*')
    .eq('receiver_id', currentId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const countEl = document.getElementById('notifyCount');
  const listEl = document.getElementById('notifyList');
  if (!countEl || !listEl) return;

  const currentLang = localStorage.getItem('safehouse_lang') || 'en';

  if (!error && notifications && notifications.length > 0) {
    countEl.innerText = notifications.length;
    countEl.style.display = 'flex';
    listEl.innerHTML = '';

    notifications.forEach(item => {
      const timeAgoStr = getRelativeTime(item.created_at);

      if (item.type === 'forum_reply') {
        listEl.innerHTML += `
          <div class="notify-item" onclick="handleForumNotificationClick('${item.id}', '${item.topic_id}')" style="padding:10px; border-bottom:1px solid #222; color:#fff; font-size:0.8rem; cursor:pointer; background:#141414; transition:background 0.2s;" onmouseover="this.style.background='#1f1f1f'" onmouseout="this.style.background='#141414'">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span style="color:#f1c40f; font-weight:bold;">@${item.sender_name}</span>
              <span style="font-size:9px; color:#777;">${timeAgoStr}</span>
            </div>
            <div style="color:#ccc; font-size:11px;">
              replied to you in topic
            </div>
          </div>`;
      } else {
        const textWants = (typeof translations !== 'undefined' && translations[currentLang]?.['wants_friends'])
          ? translations[currentLang]['wants_friends']
          : 'wants to be friends';

        listEl.innerHTML += `
          <div class="notify-item" style="padding:10px; border-bottom:1px solid #222; color:#fff; font-size:0.8rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span><b>${item.sender_name}</b> ${textWants}</span>
              <span style="font-size:9px; color:#777;">${timeAgoStr}</span>
            </div>
            <div class="notify-btns" style="display:flex; gap:5px; margin-top:5px;">
              <button class="btn-acc" onclick="respondFriend('${item.id}', 'accepted')" style="flex:1; background:#f1c40f; border:none; cursor:pointer; font-weight:bold; font-size:10px; padding:4px;">OK</button>
              <button class="btn-rej" onclick="respondFriend('${item.id}', 'rejected')" style="flex:1; background:#333; color:#fff; border:none; cursor:pointer; font-size:10px; padding:4px;">NO</button>
            </div>
          </div>`;
      }
    });
  } else {
    countEl.style.display = 'none';
    const textNoReq = (typeof translations !== 'undefined' && translations[currentLang]?.['no_requests'])
      ? translations[currentLang]['no_requests']
      : 'There are no notifications';
    listEl.innerHTML = `<div style="padding:10px; font-size:10px; color:#444; text-align:center;">${textNoReq}</div>`;
  }
};

/**
 * Перехід за сповіщенням форуму
 */
window.handleForumNotificationClick = async function(notificationId, topicId) {
  if (typeof _supabase !== 'undefined' && notificationId) {
    await _supabase.from('notifications').delete().eq('id', notificationId);
  }
  if (topicId && topicId !== 'undefined' && topicId !== 'null') {
    window.location.href = `topic.html?id=${topicId}`;
  } else {
    await window.updateFriendNotifications();
  }
};

/**
 * Відповідь на заявку в друзі
 */
window.respondFriend = async function(reqId, status) {
  if (typeof _supabase === 'undefined') return;
  try {
    if (status === 'accepted') {
      await _supabase.from('notifications').update({ status: 'accepted' }).eq('id', reqId);
    } else {
      await _supabase.from('notifications').delete().eq('id', reqId);
    }
    await window.updateFriendNotifications();
  } catch (err) {
    console.error(err);
  }
};

/**
 * Підключення Realtime для сповіщень
 */
function setupNotificationsRealtime(userId) {
  if (!userId || typeof _supabase === 'undefined') return;

  _supabase
    .channel(`notifications-realtime-${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `receiver_id=eq.${userId}`
    }, () => {
      window.updateFriendNotifications();
    })
    .subscribe();
}

/**
 * Логіка роботи модалки підтримки
 */
window.openSupportModal = async function() {
  const profile = window.myProfile;

  // Заборона гостям створювати тікети
  if (!profile || profile.isGuest) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'ACCESS DENIED',
        text: 'Support tickets are available for authorized drivers only.',
        icon: 'info',
        background: '#0a0a0a',
        color: '#fff',
        showCancelButton: true,
        confirmButtonText: 'LOG IN',
        cancelButtonText: 'CANCEL',
        confirmButtonColor: '#f1c40f',
        cancelButtonColor: '#333'
      }).then((result) => {
        if (result.isConfirmed) {
          if (typeof window.openModal === 'function') {
            window.openModal();
          } else {
            window.location.href = 'auth.html';
          }
        }
      });
    } else {
      alert('Please log in to contact support.');
    }
    return;
  }

  const overlay = document.getElementById('supportModalOverlay');
  const modal = document.getElementById('supportModal');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'block';

  if (typeof _supabase !== 'undefined') {
    await _supabase
      .from('support_tickets')
      .update({ is_read: true })
      .eq('user_id', profile.id)
      .eq('status', 'resolved');

    const badge = document.getElementById('supportAlertBadge');
    if (badge) badge.innerText = '';
  }
};

window.closeSupportModal = function() {
  const overlay = document.getElementById('supportModalOverlay');
  const modal = document.getElementById('supportModal');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
};

window.submitSupportTicket = async function() {
  const profile = window.myProfile;
  if (!profile || profile.isGuest) {
    Swal.fire({
      title: 'ERROR',
      text: 'You must be logged in to contact support.',
      icon: 'error',
      background: '#111',
      color: '#fff',
      confirmButtonColor: '#f1c40f'
    });
    return;
  }

  const descriptionEl = document.getElementById('supportDescription');
  const description = descriptionEl ? descriptionEl.value.trim() : '';

  if (!description) {
    Swal.fire({
      title: 'WARNING',
      text: 'Please enter your message.',
      icon: 'warning',
      background: '#111',
      color: '#fff',
      confirmButtonColor: '#f1c40f'
    });
    return;
  }

  if (window.currentActiveTicketId) {
    const userDescTextEl = document.getElementById('supportUserDescriptionText');
    const currentDesc = userDescTextEl ? userDescTextEl.innerText : '';
    const updatedDescription = `${currentDesc}\n\n[YOU REPLY]:\n${description}`;

    const { error } = await _supabase
      .from('support_tickets')
      .update({
        description: updatedDescription,
        status: 'pending',
        is_read: false
      })
      .eq('id', window.currentActiveTicketId);

    if (error) {
      Swal.fire({
        title: 'ERROR',
        text: 'Failed to send reply.',
        icon: 'error',
        background: '#111',
        color: '#fff',
        confirmButtonColor: '#f1c40f'
      });
    } else {
      if (descriptionEl) descriptionEl.value = '';
      window.closeSupportModal();
      Swal.fire({
        title: 'SUCCESS',
        text: 'Your reply has been sent to support!',
        icon: 'success',
        background: '#111',
        color: '#fff',
        confirmButtonColor: '#f1c40f'
      });
      window.checkAdminReplies();
    }
  } else {
    const subjectEl = document.getElementById('supportSubject');
    const subject = subjectEl ? subjectEl.value.trim() : '';

    if (!subject) {
      Swal.fire({
        title: 'WARNING',
        text: 'Please enter a subject.',
        icon: 'warning',
        background: '#111',
        color: '#fff',
        confirmButtonColor: '#f1c40f'
      });
      return;
    }

    const { error } = await _supabase.from('support_tickets').insert([{
      user_id: profile.id,
      username: profile.username,
      subject: subject,
      description: `[YOU]:\n${description}`
    }]);

    if (error) {
      Swal.fire({
        title: 'ERROR',
        text: 'Failed to send ticket.',
        icon: 'error',
        background: '#111',
        color: '#fff',
        confirmButtonColor: '#f1c40f'
      });
    } else {
      if (subjectEl) subjectEl.value = '';
      if (descriptionEl) descriptionEl.value = '';
      window.closeSupportModal();
      Swal.fire({
        title: 'SUCCESS',
        text: 'Your ticket has been sent to the support!',
        icon: 'success',
        background: '#111',
        color: '#fff',
        confirmButtonColor: '#f1c40f'
      });
      window.checkAdminReplies();
    }
  }
};

window.closeAndArchieveTicket = async function() {
  if (!window.currentActiveTicketId || typeof _supabase === 'undefined') return;

  const { error } = await _supabase
    .from('support_tickets')
    .update({ status: 'closed' })
    .eq('id', window.currentActiveTicketId);

  if (error) {
    Swal.fire({
      title: 'ERROR',
      text: 'Failed to close ticket.',
      icon: 'error',
      background: '#111',
      color: '#fff',
      confirmButtonColor: '#f1c40f'
    });
  } else {
    Swal.fire({
      title: 'CLOSED',
      text: 'Ticket closed! Now you can create a new one.',
      icon: 'success',
      background: '#111',
      color: '#fff',
      confirmButtonColor: '#f1c40f'
    });
    const subEl = document.getElementById('supportSubject');
    const descEl = document.getElementById('supportDescription');
    if (subEl) subEl.value = '';
    if (descEl) descEl.value = '';
    await window.checkAdminReplies();
  }
};

window.checkAdminReplies = async function() {
  const profile = window.myProfile;
  if (!profile || profile.isGuest || typeof _supabase === 'undefined') return;

  const { data: tickets } = await _supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', profile.id)
    .neq('status', 'closed')
    .order('created_at', { ascending: false });

  const badge = document.getElementById('supportAlertBadge');

  if (tickets && tickets.length > 0) {
    const latestTicket = tickets[0];
    window.currentActiveTicketId = latestTicket.id;

    if (latestTicket.status === 'resolved' && !latestTicket.is_read) {
      if (badge) badge.innerHTML = ' <span style="color: #ff4444; font-weight: 900;">(1)</span>';
    } else {
      if (badge) badge.innerText = '';
    }

    const subEl = document.getElementById('supportUserSubject');
    const descEl = document.getElementById('supportUserDescriptionText');
    const inputSub = document.getElementById('supportSubject');
    const inputDesc = document.getElementById('supportDescription');
    const submitBtn = document.getElementById('supportSubmitBtn');

    if (subEl) subEl.innerText = latestTicket.subject || 'No Subject';
    if (descEl) descEl.innerText = latestTicket.description;
    if (inputSub) inputSub.style.display = 'none';
    if (inputDesc) inputDesc.placeholder = "Type your reply to support here...";
    if (submitBtn) submitBtn.innerText = "SEND REPLY";

    const replyText = document.getElementById('supportReplyText');
    const adminLabel = document.getElementById('adminResponseLabel');
    const closeSection = document.getElementById('closeTicketSection');

    if (latestTicket.admin_reply) {
      if (replyText) {
        replyText.innerText = latestTicket.admin_reply;
        replyText.style.display = 'block';
      }
      if (adminLabel) adminLabel.style.display = 'block';
      if (closeSection) closeSection.style.display = 'block';
    } else {
      if (adminLabel) adminLabel.style.display = 'none';
      if (replyText) replyText.style.display = 'none';
      if (closeSection) closeSection.style.display = 'none';
    }

    const replyContainer = document.getElementById('supportReplyContainer');
    if (replyContainer) replyContainer.style.display = 'block';
  } else {
    window.currentActiveTicketId = null;
    if (badge) badge.innerText = '';

    const inputSub = document.getElementById('supportSubject');
    const inputDesc = document.getElementById('supportDescription');
    const submitBtn = document.getElementById('supportSubmitBtn');
    const replyContainer = document.getElementById('supportReplyContainer');

    if (inputSub) inputSub.style.display = 'block';
    if (inputDesc) inputDesc.placeholder = "Describe your issue in detail here...";
    if (submitBtn) submitBtn.innerText = "SEND TICKET";
    if (replyContainer) replyContainer.style.display = 'none';
  }
};

/**
 * Логіка щоденного бонусу
 */
window.checkDailyBonus = async function(me) {
  if (!me || me.isGuest || typeof _supabase === 'undefined') return;

  const today = new Date().toISOString().split('T')[0];

  if (me.last_active_date !== today) {
    const bonus = me.is_vip ? 20 : 10;
    const currentRating = me.rating || 1000;
    const newRating = currentRating + bonus;
    const newLevel = 1 + Math.floor((newRating - 1000) / 200);

    const { error } = await _supabase
      .from('profiles')
      .update({
        rating: newRating,
        level: newLevel,
        last_active_date: today
      })
      .eq('id', me.id);

    if (!error) {
      me.rating = newRating;
      me.level = newLevel;
      me.last_active_date = today;

      if (typeof Swal !== 'undefined') {
        Swal.fire({
          title: 'DAILY BONUS!',
          text: `+${bonus} RATING FOR DAILY ENTRY!`,
          icon: 'success',
          timer: 3000,
          showConfirmButton: false,
          customClass: { popup: 'nfs-crt-modal' }
        });
      }
    }
  }
};

/**
 * Вікно авторизації
 */
window.openModal = async function() {
  if (typeof _supabase === 'undefined' || typeof Swal === 'undefined') return;

  const { value: formValues } = await Swal.fire({
    title: 'RACE AUTHORIZATION',
    background: '#0a0a0a',
    color: '#fff',
    html: `
        <input id="swal-email" class="swal2-input" placeholder="Email" type="email" style="background:#111; color:#fff;">
        <input id="swal-password" class="swal2-input" placeholder="Password" type="password" style="background:#111; color:#fff;">
      `,
    focusConfirm: false,
    preConfirm: () => {
      return {
        email: document.getElementById('swal-email').value.trim(),
        password: document.getElementById('swal-password').value.trim()
      };
    }
  });

  if (formValues) {
    const { error } = await _supabase.auth.signInWithPassword({
      email: formValues.email,
      password: formValues.password,
    });

    if (error) {
      Swal.fire({ icon: 'error', title: 'ERROR', text: error.message, background: '#0a0a0a', color: '#fff' });
    } else {
      Swal.close();
      location.reload();
    }
  }
};

/**
 * Автоматичний запуск на кожній сторінці
 */
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof _supabase === 'undefined') return;

  try {
    const { data: { session } } = await _supabase.auth.getSession();

    // 1. РЕЖИМ ГОСТЯ (немає активної сесії)
    if (!session?.user) {
      window.myProfile = {
        id: null,
        username: 'Guest_' + Math.random().toString(36).substring(2, 6),
        isGuest: true,
        status: 'GUEST',
        avatar_url: 'https://via.placeholder.com/34?text=G'
      };
      window.currentUserId = null;

      if (typeof window.initGlobalStatus === 'function') {
        await window.initGlobalStatus(_supabase, null);
      }
      return;
    }

    // 2. АВТОРИЗОВАНИЙ КОРИСТУВАЧ
    const { data: profile } = await _supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (profile) {
      profile.isGuest = false;
      window.myProfile = profile;
      window.currentUserId = profile.id;

      if (typeof window.initGlobalStatus === 'function') {
        await window.initGlobalStatus(_supabase, profile);
      }

      await window.checkDailyBonus(profile);
      await window.updateGlobalMsgBadge(_supabase, profile.id);
      await window.updateFriendNotifications();
      await window.checkAdminReplies();

      // Слухач Realtime сповіщень
      setupNotificationsRealtime(profile.id);
    }
  } catch (err) {
    console.error('Auto-init error:', err);
  }
});
