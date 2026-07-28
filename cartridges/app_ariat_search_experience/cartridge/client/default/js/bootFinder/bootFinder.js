'use strict';

/**
 * Boot Finder client-side state machine. No full page reload between
 * questions - the question flow is rendered from the `questions` JSON the
 * server embedded on the modal shell, and only the final "show results now"
 * action calls BootFinder-Results via AJAX.
 */

var gtmEvents = require('../shared/gtmEvents');

var state = {
    questions: [],
    shaftHeightMode: 'string',
    currentIndex: 0,
    answers: {},
    resultsUrl: null
};

function questionTemplate(question) {
    // Minimal inline renderer - a real build would use per-type ISML
    // partials fetched once with the shell; kept inline here so the state
    // machine is legible in one file.
    return '<div class="boot-finder-question" data-question-id="' + question.id + '">'
        + '<h4>' + question.id + '</h4>'
        + '<div class="boot-finder-question__options" data-options></div>'
        + '<div class="boot-finder-question__actions">'
        + '<button type="button" class="btn btn-link" data-skip-question>Skip</button>'
        + '<button type="button" class="btn btn-link" data-show-results-now>Show results now</button>'
        + '</div>'
        + '</div>';
}

function renderCurrentQuestion($panel) {
    var question = state.questions[state.currentIndex];
    if (!question) {
        fetchResults($panel.closest('.boot-finder-modal'));
        return;
    }
    $panel.html(questionTemplate(question));
}

function recordAnswer(question, value) {
    if (question.type === 'shaft-height') {
        state.answers.shaftHeight = value;
    } else if (question.type === 'variant') {
        Object.assign(state.answers, value);
    } else if (question.field) {
        state.answers[question.field] = value;
    }
    gtmEvents.pushEvent('finder_question_answered', {
        question_id: question.id,
        answer: value
    });
}

function advance($modal) {
    state.currentIndex += 1;
    if (state.currentIndex >= state.questions.length) {
        fetchResults($modal);
        return;
    }
    renderCurrentQuestion($modal.find('[data-boot-finder-questions]'));
}

function fetchResults($modal) {
    gtmEvents.pushEvent('finder_complete', { answers: state.answers });

    var $resultsPanel = $modal.find('[data-boot-finder-results]');
    $modal.find('[data-boot-finder-questions]').attr('hidden', true);
    $resultsPanel.removeAttr('hidden');

    $.ajax({
        url: state.resultsUrl,
        method: 'GET',
        data: { answers: JSON.stringify(state.answers) },
        success: function (html) {
            $resultsPanel.html(html);
        },
        error: function () {
            $resultsPanel.html('<div class="boot-finder-results-grid boot-finder-results-grid--error">'
                + 'We could not load boot matches right now. Please try again in a moment.</div>');
        }
    });
}

function initModal($modal) {
    state.questions = JSON.parse($modal.attr('data-questions') || '[]');
    state.shaftHeightMode = $modal.attr('data-shaft-height-mode');
    state.resultsUrl = $modal.attr('data-results-url');
    state.currentIndex = 0;
    state.answers = {};

    gtmEvents.pushEvent('finder_start', {});
    renderCurrentQuestion($modal.find('[data-boot-finder-questions]'));
}

module.exports = {
    init: function () {
        $(document).on('click', '[data-dismiss-boot-finder]', function () {
            $(this).closest('.boot-finder-entry-card').attr('hidden', true);
            window.sessionStorage.setItem('boot-finder-entry-dismissed', 'true');
        });

        $(document).on('click', '[data-start-boot-finder]', function (e) {
            e.preventDefault();
            var url = $(this).data('url');
            $.get(url, function (html) {
                var $container = $('<div class="boot-finder-modal-container"></div>').html(html);
                $('body').append($container);
                initModal($container.find('.boot-finder-modal'));
            });
        });

        $(document).on('click', '[data-skip-question]', function () {
            var $modal = $(this).closest('.boot-finder-modal');
            advance($modal);
        });

        $(document).on('click', '[data-show-results-now]', function () {
            var $modal = $(this).closest('.boot-finder-modal');
            fetchResults($modal);
        });

        $(document).on('click', '[data-option]', function () {
            var $modal = $(this).closest('.boot-finder-modal');
            var question = state.questions[state.currentIndex];
            recordAnswer(question, $(this).data('option'));
            advance($modal);
        });

        $(document).on('click', '[data-boot-finder-result-click]', function () {
            gtmEvents.pushEvent('finder_result_click', {
                vg_id: $(this).data('vg-id')
            });
        });
    }
};
