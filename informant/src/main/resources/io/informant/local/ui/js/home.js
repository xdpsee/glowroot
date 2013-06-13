/*
 * Copyright 2013 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

require.config({
  paths: {
    'trace': 'js/common-trace',
    'bootstrap-modal': 'lib/bootstrap/js/bootstrap-modal',
    'bootstrap-datepicker': 'lib/bootstrap-datepicker/js/bootstrap-datepicker',
    'jquery.color': 'lib/jquery/jquery.color',
    'jquery.flot': 'lib/flot/jquery.flot',
    'jquery.flot.time': 'lib/flot/jquery.flot.time',
    'jquery.flot.selection': 'lib/flot/jquery.flot.selection',
    'jquery.flot.navigate': 'lib/flot/jquery.flot.navigate',
    'jquery.qtip': 'lib/qtip/jquery.qtip',
    'jquery-migrate': 'lib/jquery/jquery-migrate',
    'moment': 'lib/moment/moment'
  },
  shim: {
    'bootstrap-modal': ['jquery'],
    'bootstrap-datepicker': ['jquery'],
    'jquery.color': ['jquery'],
    'jquery.flot': ['jquery'],
    'jquery.flot.time': ['jquery', 'jquery.flot'],
    'jquery.flot.selection': ['jquery', 'jquery.flot'],
    'jquery.flot.navigate': ['jquery', 'jquery.flot'],
    // jquery-migrate is needed until qtip is jquery 1.9 compatible,
    // see https://github.com/Craga89/qTip2/issues/459 -->
    'jquery.qtip': ['jquery', 'jquery-migrate'],
    'jquery-migrate': ['jquery'],
    'moment': {
      exports: 'moment'
    }
  }
});

// TODO conditionally include flashcanvas for IE < 9
define(function (require) {
  'use strict';
  var $ = require('jquery');
  var moment = require('moment');
  var Spinner = require('spin');
  var Informant = require('informant');
  var Trace = require('trace');
  require('bootstrap-transition');
  require('bootstrap-collapse');
  require('bootstrap-modal');
  require('bootstrap-datepicker');
  require('jquery.color');
  require('jquery.flot');
  require('jquery.flot.time');
  require('jquery.flot.selection');
  require('jquery.flot.navigate');
  require('jquery.qtip');

  $(document).ready(function () {
    Informant.configureAjaxError();
    var plot, points;
    var fixedAggregateIntervalMillis;
    var plotSelecting;
    // previousFrom and previousTo are needed for tracking whether scroll wheel zoom is in or out
    var previousFrom, previousTo;
    var refreshQueryString;
    var options = {
      legend: { show: false },
      grid: {
        hoverable: true,
        mouseActiveRadius: 10
      },
      xaxis: { mode: 'time' },
      yaxis: { ticks: 10, zoomRange: false },
      zoom: { interactive: true, amount: 1.5 },
      colors: [
        $('#offscreenNormalColor').css('border-top-color')
      ],
      selection: { mode: 'x' },
      series: {
        points: {
          radius: 10,
          lineWidth: 0
        }
      }
    };

    var $body = $('body');
    var $chart = $('#chart');

    // qtip adds some code to the beginning of jquery's cleanData function which causes the trace
    // detail modal to close slowly when it has 5000 spans
    // this extra cleanup code is not needed anyways since cleanup is performed explicitly
    $.cleanData = $.cleanData_replacedByqTip;
    // need to track dimensions to identify real window resizes in IE which sends window
    // resize event when any element on the page is resized
    // also, now with responsive design, body width doesn't change on every window resize event
    // so body dimensions are tracked instead of window dimensions since that is what determines
    // plot dimensions
    var bodyWidth = $body.width();
    var bodyHeight = $body.height();
    $(window).resize(function () {
      // check plot in case this is a resize before initial plot is rendered
      if (plot && ($body.width() !== bodyWidth || $body.height() !== bodyHeight)) {
        bodyWidth = $body.width();
        bodyHeight = $body.height();
        plot = $.plot($chart, [points], options);
      }
    });

    function plotResponseData(from, to) {
      var queryString = 'from=' + from + '&to=' + to + '&limit=10';
      $.getJSON('aggregate/groupings?' + queryString, function (response) {
        $('#groupAggregates').html('');
        $.each(response, function (i, grouping) {
          var average = ((grouping.durationTotal / grouping.traceCount) / 1000000000).toFixed(2);
          $('#groupAggregates').append('<div>' + grouping.grouping + ': ' + average + '</div>')
        });
      });
      // update time filter before translating range to timezone-less flot values
      updateTimeFilter(from, to);
      var fromAsDate = new Date(from);
      fromAsDate.setHours(0, 0, 0, 0);
      var zoomRangeFrom = fromAsDate.getTime();
      var zoomRangeTo = zoomRangeFrom + 24 * 60 * 60 * 1000; // zoomRangeFrom + 24 hours
      from -= new Date(from).getTimezoneOffset() * 60 * 1000;
      to -= new Date(to).getTimezoneOffset() * 60 * 1000;
      zoomRangeFrom -= new Date(zoomRangeFrom).getTimezoneOffset() * 60 * 1000;
      zoomRangeTo -= new Date(zoomRangeTo).getTimezoneOffset() * 60 * 1000;
      options.xaxis.min = from;
      options.xaxis.max = to;
      options.xaxis.zoomRange = [ zoomRangeFrom, zoomRangeTo ];
      options.yaxis.min = 0;
      // reset yaxis max so it will be auto calculated to fit data points
      options.yaxis.max = undefined;
      hideTooltip();
      if (plot) {
        plot.unhighlight();
      }
      plot = $.plot($chart, [points], options);
    }

    function hideTooltip() {
      $chart.qtip('hide');
    }

    function filterPoints(points, from, to) {
      var filteredPoints = [];
      // points are in timezone-less flot values
      from -= new Date(from).getTimezoneOffset() * 60 * 1000;
      to -= new Date(to).getTimezoneOffset() * 60 * 1000;
      var i;
      for (i = 0; i < points.length; i++) {
        var point = points[i];
        if (point[0] >= from && point[0] <= to) {
          filteredPoints.push(point);
        }
      }
      return filteredPoints;
    }

    function updateTimeFilter(from, to) {
      // TODO use localized time format
      // currently momentjs provides only 'LT' for localized time but this does not include seconds
      // see http://momentjs.com/docs/#/customization/long-date-formats
      $('#timeFilter').html(moment(from).format('h:mm:ss A') + ' &nbsp; to &nbsp; '
          + moment(to).format('h:mm:ss A (Z)'));
      previousFrom = from;
      previousTo = to;
    }

    function refresh() {
      // TODO use localized date format, see more detailed comment at datepicker construction since
      // the format needs to be sync'd between the date picker and this parsing
      var date = moment($('#dateFilter').val(), 'MM/DD/YYYY');
      var from;
      var to;
      if (plot) {
        from = moment(Math.floor(plot.getAxes().xaxis.min));
        to = moment(Math.ceil(plot.getAxes().xaxis.max));
        // shift timezone
        from.add('minutes', from.zone());
        to.add('minutes', to.zone());
        var fromAsDate = from.clone();
        fromAsDate.hours(0);
        fromAsDate.minutes(0);
        fromAsDate.seconds(0);
        fromAsDate.milliseconds(0);
        if (date.valueOf() === fromAsDate.valueOf()) {
          // dateFilter hasn't changed
          from = from.valueOf();
          to = to.valueOf();
        } else {
          // dateFilter has changed
          from = date.valueOf();
          to = date.valueOf() + 24 * 60 * 60 * 1000;
        }
      } else {
        // plot.getAxes() is not yet available because the refresh button was hit refresh during
        // (a possibly very long) initial load and
        from = date.valueOf();
        to = date.valueOf() + 24 * 60 * 60 * 1000;
      }
      getTracePoints(from, to, true);
    }

    function getTracePoints(from, to, refreshButton, delay) {
      var fullQueryString = 'from=' + from + '&to=' + to;
      // handle crazy user clicking on the button
      if (refreshButton && fullQueryString === refreshQueryString) {
        return;
      }
      if (!refreshQueryString) {
        // if refreshQueryString is defined, that means spinner is already showing
        Informant.showSpinner('#chartSpinner');
      }
      refreshQueryString = fullQueryString;
      if (delay) {
        setTimeout(function () {
          if (refreshQueryString === fullQueryString) {
            // still the current query
            getTracePoints(from, to, refreshButton, false);
          }
        }, delay);
        return;
      }
      $.getJSON('aggregate/points?' + fullQueryString, function (response) {
        if (refreshQueryString !== fullQueryString) {
          // a different query string has been posted since this one
          // (or the refresh was 'canceled' by a zoom-in action that doesn't require data loading)
          return;
        }
        refreshQueryString = undefined;
        Informant.hideSpinner('#chartSpinner');
        if (refreshButton) {
          Informant.showAndFadeSuccessMessage('#refreshSuccessMessage');
        }
        points = response.points;
        fixedAggregateIntervalMillis = response.fixedAggregateIntervalSeconds * 1000
        options.zoom.gridLock = fixedAggregateIntervalMillis;
        options.selection.gridLock = fixedAggregateIntervalMillis;
        hideTooltip();
        // shift for timezone
        var i;
        for (i = 0; i < points.length; i++) {
          points[i][0] -= new Date(points[i][0]).getTimezoneOffset() * 60 * 1000;
        }
        plotResponseData(from, to);
      });
    }

    function showTraceDetailTooltip(item) {
      var x = item.pageX;
      var y = item.pageY;
      var captureTime = item.datapoint[0];
      var from = moment(captureTime - fixedAggregateIntervalMillis).format('h:mm:ss A');
      var to = moment(captureTime).format('h:mm:ss A');
      var traceCount = points[item.dataIndex][2];
      var average;
      if (traceCount == 0) {
        average = '--';
      } else {
        average = item.datapoint[1].toFixed(2);
      }
      if (traceCount == 1) {
        traceCount = traceCount + ' trace';
      } else {
        traceCount = traceCount + ' traces';
      }
      var text = '<span class="tooltip-label">From:</span>' + from + '<br>'
          + '<span class="tooltip-label">To:</span>' + to + '<br>'
          + '<span class="tooltip-label">Average:</span>' + average + ' seconds<br>'
          + '<span class="tooltip-label"></span>(' + traceCount + ')';
      $chart.qtip({
        content: {
          text: text
        },
        position: {
          my: 'bottom center',
          target: [ x, y ],
          adjust: {
            y: -10
          },
          viewport: $(window)
        },
        style: {
          classes: 'ui-tooltip-bootstrap qtip-override qtip-border-color-0'
        },
        hide: {
          event: false
        },
        show: {
          event: false
        },
        events: {
          hide: function () {
            showingItemId = undefined;
          }
        }
      });
      $chart.qtip('show');
    }

    function displayModal(initialHtml, initialFixedOffset, initialWidth, initialHeight) {
      var $modalContent = $('#modalContent');
      var $modal = $('#modal');
      $modalContent.html(initialHtml);
      $modal.removeClass('hide');
      // need to focus on something inside the modal, otherwise keyboard events won't be captured,
      // in particular, page up / page down won't scroll the modal
      $modalContent.focus();
      $modal.css('position', 'fixed');
      $modal.css('top', initialFixedOffset.top);
      $modal.css('left', initialFixedOffset.left);
      $modal.width(initialWidth);
      $modal.height(initialHeight);
      $modal.css('margin', 0);
      $modal.css('background-color', '#eee');
      $modal.css('font-size', '12px');
      $modal.css('line-height', '16px');
      $modal.modal({ 'show': true, 'keyboard': false, 'backdrop': false });
      var width = $(window).width() - 50;
      var height = $(window).height() - 50;
      $modal.animate({
        left: '25px',
        top: '25px',
        width: width + 'px',
        height: height + 'px',
        backgroundColor: '#fff',
        fontSize: '14px',
        lineHeight: '20px'
      }, 400, function () {
        if (loadDetailId) {
          // show spinner after animation, and only if still waiting for content
          Informant.showSpinner('#detailSpinner');
        }
        // this is needed to prevent the background from scrolling
        // wait until animation is complete since removing scrollbar makes the background page shift
        $body.css('overflow', 'hidden');
        // hiding the flot chart is needed to prevent a strange issue in chrome that occurs when
        // expanding a section of the details to trigger vertical scrollbar to be active, then
        // scroll a little bit down, leaving the section header visible, then click the section
        // header to collapse the section (while still scrolled down a bit from the top) and the
        // whole modal will shift down and to the right 25px in each direction (only in chrome)
        //
        // and without hiding flot chart there is another problem in chrome, in smaller browser
        // windows it causes the vertical scrollbar to get offset a bit left and upwards
        $chart.hide();
      });
      $body.append('<div class="modal-backdrop" id="modalBackdrop"></div>');
      var $modalBackdrop = $('#modalBackdrop');
      $modalBackdrop.css('background-color', '#ddd');
      $modalBackdrop.css('opacity', 0);
      $modalBackdrop.animate({
        'opacity': 0.8
      }, 400);
    }

    function hideModal() {
      // just in case spinner is still showing
      Informant.hideSpinner('#detailSpinner');
      // reset overflow so the background can scroll again
      $body.css('overflow', '');
      // re-display flot chart
      $chart.show();
      // remove large dom content first since it makes animation jerky at best
      // (and need to remove it afterwards anyways to clean up the dom)
      $('#modalContent').empty();
      var $modal = $('#modal');
      $modal.animate({
        left: (modalVanishPoint[0] - $(window).scrollLeft()) + 'px',
        top: (modalVanishPoint[1] - $(window).scrollTop()) + 'px',
        width: 0,
        height: 0,
        backgroundColor: '#eee'
      }, 200, function () {
        $modal.addClass('hide');
        $modal.modal('hide');
      });
      var $modalBackdrop = $('#modalBackdrop');
      $modalBackdrop.animate({
        'opacity': 0
      }, 200, function () {
        $modalBackdrop.remove();
      });
    }

    $chart.bind('plotzoom', function (event, plot) {
      var from = Math.floor(plot.getAxes().xaxis.min);
      var to = Math.ceil(plot.getAxes().xaxis.max);
      // convert points out of timezone-less flot values
      from += new Date(from).getTimezoneOffset() * 60 * 1000;
      to += new Date(to).getTimezoneOffset() * 60 * 1000;
      var zoomingOut = from < previousFrom || to > previousTo;
      if (zoomingOut) {
        // set delay=50 to handle rapid zooming
        getTracePoints(from, to, false, 50);
      } else {
        // no need to hit server
        // cancel any refresh in action
        if (refreshQueryString) {
          refreshQueryString = undefined;
          Informant.hideSpinner('#chartSpinner');
        }
        points = filterPoints(points, from, to);
        plotResponseData(from, to);
      }
    });
    $chart.mousedown(function () {
      hideTooltip();
    });
    $(document).keyup(function (e) {
      if (e.keyCode === 27) { // esc key
        if ($('#modal').is(':visible')) {
          hideModal();
        } else if (plotSelecting) {
          plot.clearSelection();
          cancelingPlotSelection = true;
        } else if (showingItemId) {
          // the tooltips have hide events that set showingItemId = undefined
          // so showingItemId must be checked before calling hideTooltip()
          hideTooltip();
        }
      }
    });
    var showingItemId;
    $chart.bind('plothover', function (event, pos, item) {
      if (plotSelecting && item) {
        plot.unhighlight(item.series, item.datapoint);
        return;
      }
      if (item) {
        var itemId = item.datapoint[0];
        if (itemId !== showingItemId) {
          showTraceDetailTooltip(item);
          showingItemId = itemId;
        }
      } else {
        hideTooltip();
      }
    });
    var cancelingPlotSelection;
    $(document).mousedown(function () {
      // need to reset this variable at some point, now seems good
      cancelingPlotSelection = false;
    });
    $chart.bind('plotselecting', function (event, ranges) {
      if (ranges) {
        // plotselecting events are triggered with null ranges parameter when '!selectionIsSane()'
        // (see jquery.flot.selection.js)
        plotSelecting = true;
      }
    });
    $chart.bind('plotunselected', function () {
      plotSelecting = false;
    });
    $chart.bind('plotselected', function (event, ranges) {
      if (cancelingPlotSelection) {
        // unfortunately, plotselected is still called after plot.clearSelection() in the keyup
        // event handler for the esc key
        plot.clearSelection();
        return;
      }
      plotSelecting = false;
      var from = Math.floor(ranges.xaxis.from);
      var to = Math.ceil(ranges.xaxis.to);
      from += new Date(from).getTimezoneOffset() * 60 * 1000;
      to += new Date(to).getTimezoneOffset() * 60 * 1000;
      // cancel any refresh in action
      if (refreshQueryString) {
        refreshQueryString = undefined;
        Informant.hideSpinner('#chartSpinner');
      }
      points = filterPoints(points, from, to);
      plotResponseData(from, to);
    });

    var now = new Date();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    // TODO use bootstrap-datepicker momentjs backend when it's available and then use momentjs's
    // localized format 'moment.longDateFormat.L' both here and when parsing date
    // see https://github.com/eternicode/bootstrap-datepicker/issues/24
    var $dateFilter = $('#dateFilter');
    $dateFilter.val(moment(today).format('MM/DD/YYYY'));
    $dateFilter.datepicker({format: 'mm/dd/yyyy', autoclose: true, todayHighlight: true});
    $('#refreshButton').click(refresh);
    $(".refresh-data-on-enter-key").keypress(function (event) {
      if (event.which === 13) {
        refresh();
        // without preventDefault, enter triggers 'more filters' button
        event.preventDefault();
      }
    });
    $('#zoomOut').click(function () { plot.zoomOut(); });
    $('#modalHide').click(hideModal);
    // show 2 hour interval, but nothing prior to today (e.g. if 'now' is 1am)
    var from = Math.max(today.getTime(), now.getTime() - 105 * 60 * 1000);
    var to = from + 120 * 60 * 1000;
    getTracePoints(from, to, false);
  });
});
