const { Telegraf, Markup, Scenes, Context, session, Composer }  = require('telegraf');
const express       = require('express');
const bodyParser    = require('body-parser');
const got           = require('got');
const moment        = require('moment');
const redis         = require("redis");
const config        = require('./config');
const query         = require('./query');

const WEBHOOK = `${config.ngrok}/webhook/${config.botToken}`;
const CAT_URL = 'https://catfact.ninja/fact'
const DOG_URL = 'https://dog-facts-api.herokuapp.com/api/v1/resources/dogs?number=1'
const bot = new Telegraf(config.botToken);

const redisClient = redis.createClient(config.redis);

const monthNames = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giungno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
];

const dayHours = [
    '00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11',
    '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23'
];

const hourMinutes = [
    ':00', ':05', ':10', ':15', ':20', ':25', ':30', ':35', ':40', ':45', ':50', ':55'
];

let last_message_id;
let CALENDAR_CALLBACK;

const saveMsgId = () => (ctx, next) => {
    last_message_id = ctx.update.message.message_id;
    next();
};

const checkInlineKeyboardValidity = () => (ctx, next) => {
    const new_id = ctx.update.callback_query.message.message_id;

    if (last_message_id !== undefined && new_id < last_message_id) {
        ctx.reply(`Form non più valido`)
        ctx.editMessageReplyMarkup();
    } else {
        next();
    }
};

const removeKeyboardAfterClick = () => (ctx, next) => {
    ctx.editMessageReplyMarkup();
    next();
};

const deleteMessageAfterClick = () => (ctx, next) => {
    ctx.deleteMessage(last_message_id);
    next();
};

const composeDatePickerKeyboard = function(baseMonth, dates, callbackType) {
    console.log("\nCompongo la tastiera inline con mese:", baseMonth)

    if (callbackType === undefined) {
        callbackType = CALENDAR_CALLBACK;
    } else {
        CALENDAR_CALLBACK = callbackType;
    }

    const date = moment().month(baseMonth);
    const month = date.month();
    const year = date.year();
    const day = date.date();
    let slidingDate = moment().month(baseMonth).date(2-moment().month(baseMonth).date(1).isoWeekday());

    const keyboardRows = [[
        Markup.button.callback('⬅️', `changeMonth/${parseInt(baseMonth)-1}`),
        Markup.button.callback(`${monthNames[month]} ${year}`, 'placeholderTile'),
        Markup.button.callback('➡️', `changeMonth/${parseInt(baseMonth)+1}`)
    ]];

    const dayNames = []
    for (const n of ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]) {
        dayNames.push(Markup.button.callback(n, 'placeholderTile'));
    }
    keyboardRows.push(dayNames);

    while(true) {
        let daysRow = [];
        while (daysRow.length < 7) {
            if (slidingDate.month() < month || slidingDate.month() > month) {
                daysRow.push(Markup.button.callback(' ', 'placeholderTile'));
            } else {

                // do something if slidingDate is earlier than current date?
                /*if (slidingDate.date() < day) {

                } else {

                }*/

                const dateWithEvent = dates.indexOf(slidingDate.locale('IT').format("yyyy-MM-DD")) > -1;
                const displayDate = dateWithEvent ? `${slidingDate.date()} 📌` : slidingDate.date();

                daysRow.push(
                    Markup.button.callback(displayDate,
                    `${callbackType}/${slidingDate.format("yyyy_MM_DD")}`)
                );
            }
            slidingDate.add(1, 'days');
        }
        keyboardRows.push(daysRow);
        if (slidingDate.month() > month || slidingDate.year() > year) {
            break;
        }
    }

    return Markup.inlineKeyboard(keyboardRows);
};

const composeListPickerKeyboard = function(listType) {
    let choiceList, callbackName;
    switch (listType) {
        case 'hours':
            choiceList = dayHours;
            callbackName = 'pickHour';
            break;
        case 'minutes':
            choiceList = hourMinutes;
            callbackName = 'pickMinute';
            break;
    }

    const keyboardRows = [];
    let row = [];
    for (const h of choiceList) {
        row.push(Markup.button.callback(h, `${callbackName}/${h}`));
        if (row.length === 6) {
            keyboardRows.push(row);
            row = [];
        }
    }
    return Markup.inlineKeyboard(keyboardRows);
};

const parseCbDate = function(dateStr) {
    let [year, month, day] = dateStr.split("_");
    if (month.length === 1) { month = `0${month}`; }
    if (day.length === 1) { day = `0${day}`; }
    console.log("\nCB DATE:", `${year}${month}${day}\n`)
    return moment(`${year}${month}${day}`).locale('IT');
};

bot.command('/cat', async (ctx) => {
    const res = await got(CAT_URL, { responseType: 'json' });
    console.log(res.body)
    ctx.reply(res.body.fact);
});

bot.command('/dog', async (ctx) => {
    const res = await got(DOG_URL, { responseType: 'json' });
    console.log(res.body)
    ctx.reply(res.body[0].fact);
});

bot.command('/sondaggio', async (ctx) => {
    ctx.reply("Ti piace questo bot?", Markup.inlineKeyboard([
        Markup.button.callback('👍', 'like'),
        Markup.button.callback('👎', 'dislike')
    ]));
});

bot.command('/rimuovi_tastiera', async(ctx) => {
    ctx.reply('tolta', Markup.removeKeyboard())
});

bot.action(['like','dislike'], checkInlineKeyboardValidity(), removeKeyboardAfterClick(), (ctx) => {
    const feedback = ctx.update.callback_query.data;
    ctx.reply("Grazie per il tuo feedback.");
});

bot.action(/changeMonth\/+/, checkInlineKeyboardValidity(), async (ctx) => {
    const newMonth = ctx.match.input.split("/")[1];
    const newMonthDate = moment().month(newMonth);
    const redisKey = `event_dates_${ctx.chat.id}_${newMonthDate.format("yyyy_MM")}`;
    redisClient.get(redisKey, async (err, dates) => {
        if (dates == null) {
            const res = await query.listMonthEvents(ctx.chat.id, newMonth);
            dates = res.rows.map(e => moment(e.date_event).locale('IT').format("yyyy-MM-DD"));
            redisClient.set(redisKey, JSON.stringify(dates));
        } else {
            dates = JSON.parse(dates);
        }
        ctx.editMessageReplyMarkup(
            composeDatePickerKeyboard(newMonth, dates).reply_markup,
            {
                chat_id: ctx.update.callback_query.message.chat.id,
                message_id: ctx.update.callback_query.message.message_id
            }
        );
    });
});


const newEventHandler = new Composer();
newEventHandler.action(/pickDate\/+/, removeKeyboardAfterClick(), async (ctx) => {
    let [year,month,day] = ctx.match.input.split("/")[1].split("_");
    if (month.length === 1) { month = `0${month}`; }
    if (day.length === 1) { day = `0${day}`; }
    const date = moment(`${year}${month}${day}`).locale('IT');
    ctx.session.myData.event_date = `${year}-${month}-${day}`;
    await ctx.reply("Inserisci il titolo dell'evento");
    return ctx.wizard.next();
});
newEventHandler.action(/pickHour\/+/, removeKeyboardAfterClick(), async (ctx) => {
    console.log("pickHour");
    ctx.session.myData.event_hour = ctx.match.input.split("/")[1];
    console.log(ctx.session.myData);
    await ctx.reply("Scegli i minuti", composeListPickerKeyboard('minutes'));
});
newEventHandler.action(/pickMinute\/+/, removeKeyboardAfterClick(), async (ctx) => {
    console.log("pickHour")
    ctx.session.myData.event_minutes = ctx.match.input.split("/")[1];
    console.log(ctx.session.myData);
    await ctx.replyWithMarkdown(`Riepilogo:\n- ${ctx.session.myData.event_name}\n- ${moment(ctx.session.myData.event_date).locale('IT').format("dddd D MMMM yyyy")} alle ${ctx.session.myData.event_hour}${ctx.session.myData.event_minutes}\n\nConfermi?`, Markup.inlineKeyboard([
        Markup.button.callback('👍', 'confirmEvent'),
        Markup.button.callback('👎', 'discardEvent')
    ]));
});
newEventHandler.action('confirmEvent', removeKeyboardAfterClick(), async (ctx) => {
    console.log("ConfirmEvent");
    ctx.session.myData.chatId = ctx.chat.id;
    query.createNewEvent(ctx.session.myData).then(async () => {

        const [year, month, day] = ctx.session.myData.event_date.split("-");
        console.log("MESE:", `event_dates_${ctx.chat.id}_${year}_${month}`);
        console.log("GIORNO:", `day_events_${ctx.chat.id}_${year}_${month}_${day}`);
        await redisClient.del(`event_dates_${ctx.chat.id}_${year}_${month}`);
        await redisClient.del(`day_events_${ctx.chat.id}_${year}_${month}_${day}`);

        ctx.reply("Evento creato correttamente");
        return ctx.scene.leave();
    });
});
newEventHandler.action('discardEvent', removeKeyboardAfterClick(), async (ctx) => {
    console.log("discardEvent");
    await ctx.replyWithMarkdown('Evento annullato. Digita /nuovo\\_evento per crearne uno nuovo');
    return ctx.scene.leave();
});
newEventHandler.command('exit', async (ctx) => {
  await ctx.reply('Evento annullato');
  return ctx.scene.leave();
})
newEventHandler.action('placeholderTile', (ctx) => {
    ctx.reply('Scegli una data valida');
});
newEventHandler.use((ctx) => {
  ctx.replyWithMarkdown('Completa il passaggio o digita /exit per annullare la creazione dell\'evento');
});

const newEventWizard = new Scenes.WizardScene(
  'new-event-wizard',
  async (ctx) => {
    ctx.session.myData = {};

    const currDate = moment();
    const redisKey = `event_dates_${ctx.chat.id}_${currDate.format("yyyy_MM")}`;
    redisClient.get(redisKey, async (err, dates) => {
        if (dates == null) {
            const res = await query.listMonthEvents(ctx.chat.id, moment().month());
            dates = res.rows.map(e => moment(e.date_event).locale('IT').format("yyyy-MM-DD"));
            redisClient.set(redisKey, JSON.stringify(dates));
        } else {
            dates = JSON.parse(dates);
        }
        console.log(dates);
        ctx.reply("Scegli la data dell'evento", composeDatePickerKeyboard(moment().month(), dates, "pickDate"));
        return ctx.wizard.next();
    });

  },
  newEventHandler,
  async (ctx) => {
      ctx.session.myData.event_name = ctx.message.text;
      console.log(ctx.session.myData);
      await ctx.reply("Inserisci l'ora dell'evento", composeListPickerKeyboard('hours'));
      return ctx.wizard.next();
  },
  newEventHandler,
  async (ctx) => {
      console.log(ctx.session.myData);
      await ctx.reply('Step 4');
      return ctx.wizard.next();
  },
  async (ctx) => {
    await ctx.reply('Done');
    return await ctx.scene.leave();
  }
);

bot.command('/nuovo_evento', (ctx) => {
    ctx.scene.enter('new-event-wizard');
});

bot.command('/lista_eventi', async (ctx) => {
    query.listUpcomingEvents(ctx.chat.id, 5, 0).then(res => {
        const events = res.rows;
        let message = "Prossimi eventi in programma:\n\n";
        for (e of events) {
            const dateEvent = moment(e.date_event).locale('IT');
            message = `${message}🗓️ ${e.name}, ${dateEvent.format("dddd D MMMM yyyy")} alle ${dateEvent.format("HH:mm")}\n\n`;
        }
        ctx.replyWithMarkdown(message);
    });
});

bot.command('/calendario_eventi', (ctx) => {
    const currDate = moment();
    const redisKey = `event_dates_${ctx.chat.id}_${currDate.format("yyyy_MM")}`;
    redisClient.get(redisKey, async (err, dates) => {
        if (dates == null) {
            const res = await query.listMonthEvents(ctx.chat.id, moment().month());
            dates = res.rows.map(e => moment(e.date_event).locale('IT').format("yyyy-MM-DD"));
            redisClient.set(redisKey, JSON.stringify(dates));
        } else {
            dates = JSON.parse(dates);
        }
        ctx.reply("Eventi del mese", composeDatePickerKeyboard(moment().month(), dates, "dayEvents"));
    });
});

bot.action(/dayEvents\/+/, async (ctx) => {
    const cbDate = ctx.match.input.split("/")[1];
    const date = parseCbDate(cbDate);
    const redisKey = `day_events_${ctx.chat.id}_${date.format("yyyy_MM_DD")}`;

    console.log("\n\n");
    console.log(cbDate);
    console.log(date);
    console.log(redisKey);

    redisClient.get(redisKey, async (err, events) => {
        if (events == null) {
            const res = await query.listDayEvents(ctx.chat.id, date);
            events = res.rows;
            redisClient.set(redisKey, JSON.stringify(events));
        } else {
            events = JSON.parse(events);
        }
        let message = `Eventi in programma ${date.format("dddd D MMMM yyyy")}:\n\n`;

        const keyboardRows = [];

        for (e of events) {
            const dateEvent = moment(e.date_event).locale('IT');
            message = `${message}🗓️ ${e.name} alle ${dateEvent.format("HH:mm")}\n\n`;
            keyboardRows.push([Markup.button.callback(`Cancella evento ${e.name}`, `deleteEvent/${e.id}`)]);
        }
        if (events.length > 1) {
            keyboardRows.push([Markup.button.callback(`Cancella tutti gli eventi del giorno`, `deleteDayEvents/${events[0].date_event}`)]);
        }

        ctx.replyWithMarkdown(message, Markup.inlineKeyboard(keyboardRows));
    });
});

bot.action(/deleteEvent\/+/, removeKeyboardAfterClick(), async (ctx) => {
    const eventId = ctx.match.input.split("/")[1];
    query.deleteEvent(ctx.chat.id, eventId).then(async (res) => {
        const dateEvent = moment(res.rows[0].date_event);

        console.log("MESE:", `event_dates_${ctx.chat.id}_${dateEvent.format("yyyy_MM")}`)
        console.log("GIORNO:", `day_events_${ctx.chat.id}_${dateEvent.format("yyyy_MM_DD")}`);
        await redisClient.del(`event_dates_${ctx.chat.id}_${dateEvent.format("yyyy_MM")}`);
        await redisClient.del(`day_events_${ctx.chat.id}_${dateEvent.format("yyyy_MM_DD")}`);

        ctx.reply(`Evento cancellato`);
    });
});

bot.action(/deleteDayEvents\/+/, removeKeyboardAfterClick(), async (ctx) => {
    let date = ctx.match.input.split("/")[1];
    query.deleteAllDayEvents(ctx.chat.id, date).then(async () => {

        date = moment(date);
        console.log("MESE:", `event_dates_${ctx.chat.id}_${date.format("yyyy_MM")}`);
        console.log("GIORNO:", `day_events_${ctx.chat.id}_${date.format("yyyy_MM_DD")}`);
        await redisClient.del(`event_dates_${ctx.chat.id}_${date.format("yyyy_MM")}`);
        await redisClient.del(`day_events_${ctx.chat.id}_${date.format("yyyy_MM_DD")}`);

        ctx.reply(`Eventi cancellati`);
    });
});

bot.command('/start', (ctx) => {
    query.maybeCreateNewUser(ctx.chat).then(() => {
        const displayName = ctx.chat.first_name || ctx.chat.username || '';
        ctx.replyWithMarkdown(`Ciao ${displayName}!\nPer creare un nuovo evento, digita /nuovo\\_evento`);
    });
});


const stage = new Scenes.Stage([newEventWizard], { default: 'new-event-wizard' });
bot.use(session());
bot.use(stage.middleware());


bot.launch({
  webhook: {
    domain: WEBHOOK,
    port: 5000
  }
});
