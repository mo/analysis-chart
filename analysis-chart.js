class AnalysisChart {
  constructor(argsParameter) {
    const args = Object.assign({}, argsParameter);
    const allYAxisScalingMethods = ['fixed-zero', 'fixed', 'rescale', 'custom'];
    if (allYAxisScalingMethods.indexOf(args.yAxisScalingMode) === -1) {
      args.yAxisScalingMode = 'fixed-zero';
    }

    this.onRangeSelectedCallbacks = [];
    this.onYAxisScalingChangedCallbacks = [];

    this.rootElement = args.element;
    this.rootElement.classList.add('analysis-chart');
    this.rootElement.innerHTML = `
      <div class="main-column">
              <div class="y-axis"></div>
              <div class="chart-draw-area"></div>
              <div class="x-axis"></div>
              <div class="annotation-timeline"></div>
              <div class="range-slider"></div>
      </div>
      <div class="y-zoom-slider-column">
              <div class="y-zoom-slider"></div>
      </div>
      <div class="right-column">
          <div class="legend"></div>
          <div class="options-panel">
              <div class="legend-help-text">
                  <span class="arrow">&#x2B11;</span> <span>too much clutter? uncheck to temporarily hide metrics</span>
              </div>
              <div class="scaling-buttons-container">
                  <label>
                      <input type="radio" name="y-axis-scaling" class="btn-fixed-zero" />
                      Fixed Y-axis (fit to data, always include zero)
                  </label>
                  <label>
                      <input type="radio" name="y-axis-scaling" class="btn-fixed" />
                      Fixed Y-axis (fit to data, with padding)
                  </label>
                  <label>
                      <input type="radio" name="y-axis-scaling" class="btn-rescale" />
                      Rescale Y-axis to currently visible data
                  </label>
                  <label>
                      <input type="radio" name="y-axis-scaling" class="btn-custom" />
                      Select Y-axis range using slider
                  </label>
              </div>
          </div>
          <div>
              <div class="selection-inactive">Nothing selected. Drag-select a part of the chart using the mouse to create a selection.</div>
              <div class="selection-active">
                  <table>
                  <tr><td>From:</td><td class="selection-start-time"></td></tr>
                  <tr><td>To:</td><td class="selection-stop-time"></td></tr>
                  </table>
                  <div class="selection-diff-container"></div>
                  <div class="selection-extra-info"></div>
              </div>
          </div>
      </div>`;
    const totalWidth = args.width || 2000;
    const rightColumnWidth = args.rightColumnWidth || 300;
    const yAxisWidth = args.yAxisWidth || 100;
    // The space between the main chart area and the right column is larger if
    // the y-axis zoom slider is visible.
    const rightColumnLeftMarginApprox = 75;
    const chartDrawAreaWidth = totalWidth - rightColumnWidth - yAxisWidth - rightColumnLeftMarginApprox;
    this.rootElement.querySelector('.main-column').style.width = chartDrawAreaWidth;
    this.rootElement.querySelector('.main-column').style.marginLeft = yAxisWidth;
    this.rootElement.querySelector('.legend').style.minWidth = rightColumnWidth;
    this.rootElement.querySelector('.legend').style.maxWidth = rightColumnWidth;
    this.rootElement.querySelector('.y-axis').style.width = yAxisWidth;
    this.rootElement.querySelector('.y-axis').style.marginLeft = -yAxisWidth;

    this.series = args.series;
    this.allSeriesYMin = d3.min(args.series, serie => d3.min(serie.data, datapoint => datapoint.y));
    this.allSeriesYMax = d3.max(args.series, serie => d3.max(serie.data, datapoint => datapoint.y));
    this.allSeriesYSpan = this.allSeriesYMax - this.allSeriesYMin;
    this.distanceFurthestFromZero = Math.max(Math.abs(this.allSeriesYMin), Math.abs(this.allSeriesYMax));
    this.yFixedMin = this.allSeriesYMin - 0.1 * this.allSeriesYSpan;
    this.yFixedMax = this.allSeriesYMax + 0.1 * this.allSeriesYSpan;

    const chartDrawArea = this.rootElement.querySelector('.chart-draw-area');
    const graph = this.graph = new Rickshaw.Graph({
      element: chartDrawArea,
      width: chartDrawAreaWidth,
      height: args.height || 500,
      interpolation: 'linear',
      stack: false,
      series: args.series.map((serie, idx) => {
        if (!serie.color) {
          const serieCopy = Object.assign({}, serie);
          const DEFAULT_COLORS = [
            '#1f77b4', '#ff7f0e', '#2ca02c',
            '#d62728', '#9467bd', '#8c564b',
            '#e377c2', '#7f7f7f', '#ffc670',
            '#17becf', '#76f992',
          ];
          serieCopy.color = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
          return serieCopy;
        }
        return serie;
      }),
    });
    graph.setRenderer('line');
    graph.render();

    if (args.series.length > 1) {
      this.rootElement.querySelector('.legend-help-text').style.display = 'block';
    }

    const xAxis = new Rickshaw.Graph.Axis.X({
      graph: graph,
      tickFormat: x => AnalysisChart.timestampToDate(x),
      orientation: 'bottom',
      pixelsPerTick: 120,
      element: this.rootElement.querySelector('.x-axis'),
    });
    xAxis.render();

    const yAxis = new Rickshaw.Graph.Axis.Y({
      graph: graph,
      orientation: 'left',
      tickFormat: v => v.toLocaleString(),
      element: this.rootElement.querySelector('.y-axis'),
    });
    yAxis.render();

    const legend = new Rickshaw.Graph.Legend({
      element: this.rootElement.querySelector('.legend'),
      graph: graph,
    });

    const highlight = new Rickshaw.Graph.Behavior.Series.Highlight({
      graph: graph,
      legend: legend
    });

    const shelving = new Rickshaw.Graph.Behavior.Series.Toggle({
      graph: graph,
      legend: legend,
    });

    const hoverDetail = new Rickshaw.Graph.HoverDetail({
      graph: graph,
      xFormatter: args.xFormatter,
      yFormatter: y => y.toLocaleString(),
    });

    const rangeSlider = new Rickshaw.Graph.RangeSlider({
      graph: graph,
      element: this.rootElement.querySelector('.range-slider'),
    });

    this.yZoomSlider = $(this.rootElement).find('.y-zoom-slider').hide().height(args.height).slider({
      range: true,
      orientation: 'vertical',
      min: this.yFixedMin,
      max: this.yFixedMax,
      step: (this.yFixedMax - this.yFixedMin) / 1000,
      values: [this.yFixedMin, this.yFixedMax],
      slide: (event, ui) => {
        graph.configure({
          min: ui.values[0],
          max: ui.values[1],
        });
        this.graph.render();
      },
    });

    const annotator = new Rickshaw.Graph.Annotate({
      graph: graph,
      element: this.rootElement.querySelector('.annotation-timeline'),
    });

    for (let timestamp in args.annotations) {
      annotator.add(timestamp, AnalysisChart.timestampToDate(timestamp) + ': ' + args.annotations[timestamp]);
    }
    annotator.update();

    chartDrawArea.style.position = 'relative';
    const drawAreaBoundingRect = this.drawAreaBoundingRect = chartDrawArea.getBoundingClientRect();
    this.selectionOutline = chartDrawArea.appendChild(document.createElement('div'));
    this.selectionOutline.className += 'selection-outline';
    this.selectionOutline.style.position = 'absolute';
    this.selectionOutline.style.border = '1px dashed black';
    this.selectionOutline.style['pointer-events'] = 'none';
    let isMouseDown = false;
    let selStartX;

    chartDrawArea.addEventListener('mousedown', (ev) => {
      selStartX = ev.clientX;
      this.selectionOutline.style.left = ev.clientX - drawAreaBoundingRect.left;
      this.selectionOutline.style.top = 0;
      this.selectionOutline.style.width = 0;
      this.selectionOutline.style.height = chartDrawArea.clientHeight - 2;
      isMouseDown = true;
      // Selection should remain hidden until cursor has moved at least 10 px.
      this.hideSelection();
      chartDrawArea.querySelector('.detail').style.display = 'none';
      ev.preventDefault();
    });
    chartDrawArea.addEventListener('mousemove', (ev) => {
      const selEndX = ev.clientX;
      if (isMouseDown) {
        const selectionWidth = Math.abs(selEndX - selStartX);
        this.selectionOutline.style.left = Math.min(selStartX, selEndX) - drawAreaBoundingRect.left;
        this.selectionOutline.style.width = selectionWidth;

        this.updateSelectionInfo(selStartX, selEndX);

        if (selectionWidth > 10) {
          this.selectionOutline.style.display = 'block';
        }
      }
    });
    chartDrawArea.addEventListener('mouseup', (ev) => {
      if (isMouseDown) {
        isMouseDown = false;
        const selEndX = ev.clientX;
        const selectionWidth = Math.abs(selEndX - selStartX);
        chartDrawArea.querySelector('.detail').style.display = 'block';
        if (selectionWidth < 10) {
          // Classify this "drag" as a "click" instead and remove selection
          this.hideSelection();
        }
      }
    });
    chartDrawArea.addEventListener('mouseleave', (ev) => {
      if (isMouseDown) {
        isMouseDown = false;
      }
    });
    rangeSlider.onSlide(() => {
      this.hideSelection();
    });
    this.hideSelection();

    this.rootElement.querySelector('.btn-fixed-zero').addEventListener('click', (ev) => {
      this.setYAxisScaling('fixed-zero');
    });


    this.rootElement.querySelector('.btn-fixed').addEventListener('click', (ev) => {
      this.setYAxisScaling('fixed');
    });

    this.rootElement.querySelector('.btn-rescale').addEventListener('click', (ev) => {
      this.setYAxisScaling('rescale');
    });

    this.rootElement.querySelector('.btn-custom').addEventListener('click', (ev) => {
      this.setYAxisScaling('custom');
    });

    const setYAxisScalingPrivate = (mode) => {
      switch (mode) {
        case 'fixed-zero':
          this.yZoomSlider.hide();
          this.graph.configure({
            min: Math.min(this.allSeriesYMin, 0),
            max: Math.max(this.allSeriesYMax + 0.1 * this.distanceFurthestFromZero, 0),
          });
          this.graph.render();
          break;
        case 'fixed':
          this.yZoomSlider.hide();
          this.graph.configure({
            min: this.yFixedMin,
            max: this.yFixedMax,
          });
          this.graph.render();
          break;
        case 'rescale':
          this.yZoomSlider.hide();
          this.graph.configure({
            min: 'auto',
            max: undefined,
          });
          this.graph.render();
          break;
        case 'custom':
          this.yZoomSlider.show();
          this.graph.configure({
            min: this.yFixedMin,
            max: this.yFixedMax,
          });
          this.graph.render();
          break;
      }
    };

    this.setYAxisScaling = (mode) => {
      setYAxisScalingPrivate(mode);
      this.onYAxisScalingChangedCallbacks.forEach((callback) => {
        callback(mode);
      });
    };

    this.rootElement.querySelector(`.btn-${args.yAxisScalingMode}`).checked = true;
    setTimeout(() => setYAxisScalingPrivate(args.yAxisScalingMode), 0);
  }

  onYAxisScalingChanged(callback) {
    this.onYAxisScalingChangedCallbacks.push(callback);
  }

  hideSelection() {
    this.selectionOutline.style.display = 'none';
    this.rootElement.querySelector('.selection-inactive').style.display = 'block';
    this.rootElement.querySelector('.selection-active').style.display = 'none';
  }

  static appendSeriesDiff(series, datapointsInRange, selDiffContainer) {
    const firstDatapointInRange = datapointsInRange.slice(0, 1)[0];
    const lastDatapointInRange = datapointsInRange.slice(-1)[0];
    const diffAbsoluteValue = lastDatapointInRange.y - firstDatapointInRange.y;
    let diffPrefix;
    if (diffAbsoluteValue >= 0) {
      diffPrefix = '+';
    } else {
      diffPrefix = '';
    }
    const diffPercentageValue = (100 * lastDatapointInRange.y / firstDatapointInRange.y - 100).toFixed(2);
    const diffPercentageStr = diffPrefix + diffPercentageValue;
    const diffAbsoluteStr = diffPrefix + diffAbsoluteValue.toLocaleString();
    const absoluteFrom = firstDatapointInRange.y.toLocaleString();
    const absoluteTo = lastDatapointInRange.y.toLocaleString();
    const median = AnalysisChart.median(datapointsInRange.map(dp => dp.y));
    const medianStr = median.toLocaleString();
    const durationSeconds = lastDatapointInRange.x - firstDatapointInRange.x;
    const [amount, unit] = AnalysisChart.durationInLargestUnitThatFits(durationSeconds);

    selDiffContainer.innerHTML += `
      <div class="diff-wrapper-outer">
          <span class="colorbox" style="background: ${series.color}"></span>
          <div class="diff-wrapper-inner">
              <div>${series.name}</div>
              <div class=".diff-value">${diffPercentageStr}% (${diffAbsoluteStr}) ${absoluteFrom} &#x2799; ${absoluteTo}</div>
              <div class=".diff-value">Duration: ${amount.toFixed(2)} ${unit}s</div>
              <div class=".diff-value">Median: ${medianStr}</div>
              <div class=".diff-value">
                <div>Per year: ${(diffAbsoluteValue / (durationSeconds / (365 * 24 * 60 * 60))).toLocaleString()}</div>
                <div>Per month: ${(diffAbsoluteValue / (durationSeconds / (30 * 24 * 60 * 60))).toLocaleString()}</div>
                <div>Per week: ${(diffAbsoluteValue / (durationSeconds / (7 * 24 * 60 * 60))).toLocaleString()}</div>
                <div>Per day: ${(diffAbsoluteValue / (durationSeconds / (24 * 60 * 60))).toLocaleString()}</div>
                <div>Per hour: ${(diffAbsoluteValue / (durationSeconds / (60 * 60))).toLocaleString()}</div>
                <div>Per minute: ${(diffAbsoluteValue / (durationSeconds / 60)).toLocaleString()}</div>
                <div>Per second: ${(diffAbsoluteValue / durationSeconds).toLocaleString()}</div>
              </div>
          </div>
      </div>`;
  }

  updateSelectionInfo(selStartX, selEndX) {
    const selLeft = Math.min(selStartX, selEndX);
    const selRight = Math.max(selStartX, selEndX);
    const from = this.getTimeAtChartXCoord(selLeft);
    const fromTimestamp = this.graph.x.invert(selLeft - this.drawAreaBoundingRect.left);
    const to = this.getTimeAtChartXCoord(selRight);
    const toTimestamp = this.graph.x.invert(selRight - this.drawAreaBoundingRect.left);
    this.rootElement.querySelector('.selection-inactive').style.display = 'none';
    this.rootElement.querySelector('.selection-active').style.display = 'block';

    this.rootElement.querySelector('.selection-start-time').innerText = from.toISOString().replace('T', ' ').slice(0, 16);
    this.rootElement.querySelector('.selection-stop-time').innerText = to.toISOString().replace('T', ' ').slice(0, 16);

    const selDiffContainer = this.rootElement.querySelector('.selection-diff-container');
    selDiffContainer.innerHTML = '';
    this.series.forEach((series) => {
      const datapointsInRange = AnalysisChart.getDatapointInRange(fromTimestamp, toTimestamp, series);
      if (datapointsInRange.length > 0) {
        AnalysisChart.appendSeriesDiff(series, datapointsInRange, selDiffContainer);
      }
    });

    this.onRangeSelectedCallbacks.forEach((callback) => {
      callback(fromTimestamp, toTimestamp);
    });
  }

  onRangeSelected(callback) {
    this.onRangeSelectedCallbacks.push(callback);
  }

  getTimeAtChartXCoord(x) {
    return new Date(1000 * this.graph.x.invert(x - this.drawAreaBoundingRect.left));
  }

  // Returns YYYY-mm-dd HH:MM:SS in local timezone.
  static timestampToDatetimeString(unixTimestamp) {
    const ts = new Date(unixTimestamp * 1000);
    const year = ts.getFullYear();
    const month = ('0' + (ts.getMonth() + 1)).slice(-2);
    const day = ('0' + (ts.getDate())).slice(-2);
    const hour = ('0' + ts.getHours()).slice(-2);
    const minute = ('0' + ts.getMinutes()).slice(-2);
    const second = ('0' + ts.getSeconds()).slice(-2);
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  // Returns YYYY-mm-dd in local timezone.
  static timestampToDate(x) {
    return this.timestampToDatetimeString(x).substring(0, 10);
  }

  static median(vals) {
    const valsCopy = vals.slice();
    valsCopy.sort();
    const count = valsCopy.length;
    const middleIdx = Math.floor(count / 2);
    if (count % 2 === 0) {
      return (valsCopy[middleIdx - 1] + valsCopy[middleIdx]) / 2;
    }
    return valsCopy[middleIdx];
  }

  static durationInLargestUnitThatFits(durationSeconds) {
    const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
    if (durationSeconds > SECONDS_PER_YEAR) {
      return [durationSeconds / SECONDS_PER_YEAR, 'year'];
    }

    const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;
    if (durationSeconds > SECONDS_PER_MONTH) {
      return [durationSeconds / SECONDS_PER_MONTH, 'month'];
    }

    const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;
    if (durationSeconds > SECONDS_PER_WEEK) {
      return [durationSeconds / SECONDS_PER_WEEK, 'week'];
    }

    const SECONDS_PER_DAY = 24 * 60 * 60;
    if (durationSeconds > SECONDS_PER_DAY) {
      return [durationSeconds / SECONDS_PER_DAY, 'day'];
    }

    const SECONDS_PER_HOUR = 60 * 60;
    if (durationSeconds > SECONDS_PER_HOUR) {
      return [durationSeconds / SECONDS_PER_HOUR, 'hour'];
    }

    const SECONDS_PER_MINUTE = 60;
    if (durationSeconds > SECONDS_PER_MINUTE) {
      return [durationSeconds / SECONDS_PER_MINUTE, 'minute'];
    }

    return [durationSeconds, 'second'];
  }

  static getDatapointInRange(timestampFrom, timestampTo, series) {
    const datapointsInRange = [];
    for (let datapoint of series.data) {
      const x = datapoint.x;
      if (timestampFrom <= x && x <= timestampTo) {
        datapointsInRange.push(datapoint);
      }
    }
    return datapointsInRange;
  }
}
