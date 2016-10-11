class AnalysisChart {
    constructor(args) {
        const allYAxisScalingMethods = ["fixed-zero", "fixed", "rescale"];
        if (allYAxisScalingMethods.indexOf(args.yAxisScalingMode) == -1) {
            args.yAxisScalingMode = "fixed-zero";
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
        const chartDrawAreaWidth = totalWidth - rightColumnWidth;
        this.rootElement.querySelector(".main-column").style.width = chartDrawAreaWidth;
        this.rootElement.querySelector(".main-column").style.marginLeft = yAxisWidth;
        this.rootElement.querySelector(".legend").style.minWidth = rightColumnWidth;
        this.rootElement.querySelector(".y-axis").style.width = yAxisWidth;
        this.rootElement.querySelector(".y-axis").style.marginLeft = -yAxisWidth;

        this.series = args.series;
        this.allSeriesYMin = d3.min(args.series, serie => d3.min(serie.data, datapoint => datapoint.y));
        this.allSeriesYMax = d3.max(args.series, serie => d3.max(serie.data, datapoint => datapoint.y));
        this.allSeriesYSpan = this.allSeriesYMax - this.allSeriesYMin;
        this.distanceFurthestFromZero = Math.max(Math.abs(this.allSeriesYMin), Math.abs(this.allSeriesYMax));

        const chartDrawArea = this.rootElement.querySelector(".chart-draw-area");
        const graph = this.graph = new Rickshaw.Graph( {
                element: chartDrawArea,
                width: chartDrawAreaWidth,
                height: args.height || 500,
                interpolation: "linear",
                stack: false,
                series: args.series
        } );
        graph.setRenderer('line');
        graph.render();

        this.rootElement.querySelector('.btn-fixed-zero').addEventListener('click', (ev) => {
            this.setYAxisScaling("fixed-zero");
        });


        this.rootElement.querySelector('.btn-fixed').addEventListener('click', (ev) => {
            this.setYAxisScaling("fixed");
        });

        this.rootElement.querySelector('.btn-rescale').addEventListener('click', (ev) => {
            this.setYAxisScaling("rescale");
        });

        this.rootElement.querySelector('.btn-' + args.yAxisScalingMode).checked = true;
        this.setYAxisScaling(args.yAxisScalingMode);

        if (args.series.length > 1) {
            this.rootElement.querySelector('.legend-help-text').style.display = "block";
        }

        var xAxis = new Rickshaw.Graph.Axis.X({
            graph: graph,
            tickFormat: (x) => AnalysisChart.timestampToDate(x),
            orientation: "bottom",
            pixelsPerTick: 120,
            element: this.rootElement.querySelector('.x-axis'),
        });
        xAxis.render();

        const yAxis = new Rickshaw.Graph.Axis.Y({
            graph: graph,
            orientation: 'left',
            tickFormat: (v) => v.toLocaleString(),
            element: this.rootElement.querySelector('.y-axis'),
        });
        yAxis.render();

        const legend = new Rickshaw.Graph.Legend({
            element: this.rootElement.querySelector('.legend'),
            graph: graph
        });

        const shelving = new Rickshaw.Graph.Behavior.Series.Toggle({
            graph: graph,
            legend: legend
        });

        const hoverDetail = new Rickshaw.Graph.HoverDetail({
            graph: graph,
            xFormatter: args.xFormatter,
            yFormatter: function(y) { return y.toLocaleString() }
        });

        const rangeSlider = new Rickshaw.Graph.RangeSlider({
            graph: graph,
            element: this.rootElement.querySelector('.range-slider')
        });

        const annotator = new Rickshaw.Graph.Annotate({
            graph: graph,
            element: this.rootElement.querySelector('.annotation-timeline')
        });

        for (let timestamp in args.annotations) {
            annotator.add(timestamp, AnalysisChart.timestampToDate(timestamp) + ": " + args.annotations[timestamp]);
        }
        annotator.update();

        chartDrawArea.style.position = "relative";
        const drawAreaBoundingRect = this.drawAreaBoundingRect = chartDrawArea.getBoundingClientRect();
        this.selectionOutline = chartDrawArea.appendChild(document.createElement("div"));
        this.selectionOutline.className += "selection-outline";
        this.selectionOutline.style.position = "absolute";
        this.selectionOutline.style.border = "1px dashed black";
        this.selectionOutline.style['pointer-events'] = "none";
        let isMouseDown = false;
        let selStartX;

        chartDrawArea.addEventListener("mousedown", (ev) => {
            selStartX = ev.clientX;
            this.selectionOutline.style.left = ev.clientX - drawAreaBoundingRect.left;
            this.selectionOutline.style.top = 0;
            this.selectionOutline.style.width = 0;
            this.selectionOutline.style.height = chartDrawArea.clientHeight - 2;
            isMouseDown = true;
            // Selection should remain hidden until cursor has moved at least 10 px.
            this.hideSelection();
            chartDrawArea.querySelector(".detail").style.display = "none";
            ev.preventDefault();
        });
        chartDrawArea.addEventListener("mousemove", (ev) => {
            const selEndX = ev.clientX;
            if (isMouseDown) {
                const selectionWidth = Math.abs(selEndX - selStartX);
                this.selectionOutline.style.left = Math.min(selStartX, selEndX) - drawAreaBoundingRect.left;
                this.selectionOutline.style.width = selectionWidth;

                this.updateSelectionInfo(selStartX, selEndX);

                if (selectionWidth > 10) {
                    this.selectionOutline.style.display = "block";
                }
            }
        });
        chartDrawArea.addEventListener("mouseup", (ev) => {
            if (isMouseDown) {
                isMouseDown = false;
                const selEndX = ev.clientX;
                const selectionWidth = Math.abs(selEndX - selStartX);
                chartDrawArea.querySelector(".detail").style.display = "block";
                if (selectionWidth < 10) {
                    // Classify this "drag" as a "click" instead and remove selection
                    this.hideSelection();
                }
            }
        });
        chartDrawArea.addEventListener("mouseleave", (ev) => {
            if (isMouseDown) {
                isMouseDown = false;
            }
        });
        rangeSlider.onSlide(() => {
            this.hideSelection();
        });
        this.hideSelection();
    }

    setYAxisScaling(mode) {
        switch (mode) {
            case "fixed-zero":
                this.graph.configure({
                    min: Math.min(this.allSeriesYMin, 0),
                    max: Math.max(this.allSeriesYMax + 0.1 * this.distanceFurthestFromZero, 0),
                });
                this.graph.render();
                break;
            case "fixed":
                this.graph.configure({
                    min: this.allSeriesYMin - 0.1 * this.allSeriesYSpan,
                    max: this.allSeriesYMax + 0.1 * this.allSeriesYSpan,
                });
                this.graph.render();
                break;
            case "rescale":
                this.graph.configure({
                    min: "auto",
                    max: undefined,
                });
                this.graph.render();
                break;
        }
        this.onYAxisScalingChangedCallbacks.forEach((callback) => {
            callback(mode);
        });
    }

    onYAxisScalingChanged(callback) {
        this.onYAxisScalingChangedCallbacks.push(callback);
    }

    hideSelection() {
        this.selectionOutline.style.display = "none";
        this.rootElement.querySelector(".selection-inactive").style.display = "block";
        this.rootElement.querySelector(".selection-active").style.display = "none";
    }

    updateDiff(series, firstDatapointInRange, lastDatapointInRange, selDiffContainer) {
        const diffAbsoluteValue = lastDatapointInRange.y - firstDatapointInRange.y;
        let diffPrefix;
        if (diffAbsoluteValue >= 0) {
            diffPrefix = '+';
        } else {
            diffPrefix = '';
        }
        const diffPercentageValue = (100*lastDatapointInRange.y/firstDatapointInRange.y - 100).toFixed(2);
        const diffPercentageStr = diffPrefix + diffPercentageValue;
        const diffAbsoluteStr = diffPrefix + diffAbsoluteValue.toLocaleString();
        const absoluteFrom = firstDatapointInRange.y.toLocaleString();
        const absoluteTo = lastDatapointInRange.y.toLocaleString();

        selDiffContainer.innerHTML += `
            <div class="diff-wrapper-outer">
                <span class="colorbox" style="background: ${series.color}"></span>
                <div class="diff-wrapper-inner">
                    <div>${series.name}</div>
                    <div class=".diff-value">${diffPercentageStr}% (${diffAbsoluteStr}) ${absoluteFrom} &#x2799; ${absoluteTo}</div>
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
        this.rootElement.querySelector(".selection-inactive").style.display = "none";
        this.rootElement.querySelector(".selection-active").style.display = "block";

        this.rootElement.querySelector(".selection-start-time").innerText = from.toISOString().replace("T", " ").slice(0, 16);
        this.rootElement.querySelector(".selection-stop-time").innerText = to.toISOString().replace("T", " ").slice(0, 16);

        const selDiffContainer = this.rootElement.querySelector(".selection-diff-container");
        selDiffContainer.innerHTML = '';
        this.series.forEach(series => {
            const [firstDatapointInRange, lastDatapointInRange] = this.getFirstAndLastDatapointInRange(fromTimestamp, toTimestamp, series);
            if (firstDatapointInRange) {
                this.updateDiff(series, firstDatapointInRange, lastDatapointInRange, selDiffContainer);
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
        const day = ('0'+(ts.getDate())).slice(-2);
        const hour = ('0' + ts.getHours()).slice(-2);
        const minute = ('0' + ts.getMinutes()).slice(-2);
        const second = ('0' + ts.getSeconds()).slice(-2);
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }

    // Returns YYYY-mm-dd in local timezone.
    static timestampToDate(x) {
        return this.timestampToDatetimeString(x).substring(0, 10);
    }

    getFirstAndLastDatapointInRange(timestampFrom, timestampTo, series) {
        let firstDatapointInRange = undefined;
        let lastDatapointInRange = undefined;
        for (var datapoint of series.data) {
            const x = datapoint.x;
            const y = datapoint.y;
            if (timestampFrom < x && x < timestampTo) {
                if (!firstDatapointInRange || x - timestampFrom < firstDatapointInRange.x - timestampFrom) {
                    firstDatapointInRange = datapoint;
                }
                if (!lastDatapointInRange || timestampTo - x < timestampTo - lastDatapointInRange.x) {
                    lastDatapointInRange = datapoint;
                }
            }
        }
        return [firstDatapointInRange, lastDatapointInRange];
    }
}
