const pg            = require('pg');
const moment        = require('moment');
const config        = require('./config');

const dbClient = new pg.Client({
  user: config.db.user,
  host: config.db.host,
  database: config.db.name,
  password: config.db.password,
  port: config.db.port,
})
dbClient.connect();

// todo move in utils
const parseDate = function(dateStr, timeStr) {
    const [yy, mm, dd] = dateStr.split("-");
    const dateTime = (timeStr !== undefined) ? ` ${timeStr}` : ``;
    return moment(`${yy}-${mm}-${dd}${dateTime}`);
};

const runQuery = function(query, params) {
    return dbClient.query(query, params);
}

const maybeCreateNewUserQuery = function() {
    return `
        insert into users(chat_id, first_name, last_name, username, date_start)
        values ($1, $2, $3, $4, now()::timestamptz)
        on conflict (chat_id) do nothing
    `;
};

exports.maybeCreateNewUser = function(chat) {
    const queryParams = [chat.id, chat.first_name, chat.last_name, chat.username];
    return runQuery(maybeCreateNewUserQuery(), queryParams);
};

const createNewEventQuery = function() {
    return `
        insert into events(user_id, name, date_event, date_created)
        select u.id, $2::text, $3::timestamptz, now()
        from users u where u.chat_id = $1
    `;
};

exports.createNewEvent = function(eventData) {
    const eventDate = parseDate(eventData.event_date, `${eventData.event_hour}${eventData.event_minutes}`);
    const queryParams = [eventData.chatId, eventData.event_name, eventDate];
    return runQuery(createNewEventQuery(), queryParams);
};

const deleteEventQuery = function() {
    return `
        update events e
        set deleted = true
        from users u
        where e.user_id = u.id
        and u.chat_id = $1
        and e.id = $2
        returning e.date_event::date
    `;
};

exports.deleteEvent = function(chatId, eventId) {
    return runQuery(deleteEventQuery(), [chatId, eventId]);
};

const deleteAllDayEventsQuery = function(chatId, date) {
    return `
        update events e
        set deleted = true
        from users u
        where e.user_id = u.id
        and u.chat_id = $1
        and e.date_event::date = $2
    `;
};

exports.deleteAllDayEvents = function(chatId, date) {
    return runQuery(deleteAllDayEventsQuery(), [chatId, date]);
};

const listUpcomingEventsQuery = function() {
    return query = `
        select e.*
        from events e join users u on e.user_id = u.id
        where u.chat_id = $1
        and date_event > now()
        and deleted is not true
        order by e.date_event asc
        limit $2
        offset $3
    `;
};

exports.listUpcomingEvents = function(chatId, limit, offset) {
    return runQuery(listUpcomingEventsQuery(), [chatId, limit || 5, offset || 0]);
};

const listDayEventsQuery = function(date) {
    return `
        select e.*
        from events e join users u on e.user_id = u.id
        where u.chat_id = $1
        and date_event::date = '${date.locale('IT').format("yyyy-MM-DD")}'
        and deleted is not true
        order by e.date_event asc
    `;
};

exports.listDayEvents = function(chatId, date) {
    return runQuery(listDayEventsQuery(date), [chatId]);
};

const listMonthEventsQuery = function(month) {
    const startMonth = moment().month(month).date(1);
    return `
        select e.*
        from events e join users u on e.user_id = u.id
        where u.chat_id = $1
        and deleted is not true
        and date_event >= '${startMonth.locale('IT').format("yyyy-MM-DD")}'
        and date_event < '${startMonth.add(1, 'months').locale('IT').format("yyyy-MM-DD")}'
    `;
};

exports.listMonthEvents = function(chatId, month) {
    return runQuery(listMonthEventsQuery(month), [chatId]);
};

const saveUserFeedbackQuery = function() {
    return `
        insert into feedbacks(user_id, feedback, message, date_sent)
        select u.id, $2, $3, now()
        from users u where chat_id = $1
    `;
};

exports.saveUserFeedback = function(context) {
    const chatId = context.chat.id;
    const feedback = context.session.myData.feedback;
    const message = context.session.myData.feedback_msg;
    return runQuery(saveUserFeedbackQuery(), [chatId, feedback, message]);
}
