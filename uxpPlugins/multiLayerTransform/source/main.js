const { action, app, constants, core } = require("photoshop");

/** transform multiple layer(mask)s. */
class MultiLayerTransform {
  static _TARGET_SELECTION = [{ _property: "selection", _ref: "channel" }];
  static #TARGET_LAYER = [{ _enum: "ordinal", _ref: "layer", _value: "targetEnum" }];
  #_isSelectionExists = undefined;

  constructor()
  {
    // Initialize
    /** @type {Document} active document */
    this.doc = app.activeDocument;
    /** @type {number} active document ID */
    this.docId = this.doc.id;
    /** @type {Layer[]} active layers */
    this.activeLayers = this.doc.activeLayers;
    const isIncludeHiddenLayers = document.getElementById("isIncludeHiddenLayers").checked;
    /** @type {Layer[]} target layers */
    this.targetLayers = isIncludeHiddenLayers ? this.activeLayers : this.activeLayers.filter(layer => layer.visible);
    /** @type {number[]} active layer IDs */
    this.activeLayerIds = this.activeLayers.map(layer => layer.id);
    /** @type {string} 選択範囲を一時的に保存するレイヤーの名前 */
    this.tempSelectionLayerName = `__tempSelection_${Date.now()}`;
  }

  /** 選択範囲が存在するかどうかを返す */
  async #isSelectionExists() {
    if (this.#_isSelectionExists === undefined) {
      this.#_isSelectionExists = await this.#checkSelectionExists();
    }

    return this.#_isSelectionExists;
  }

  /** 選択範囲が存在するかどうかをチェックする */
  async #checkSelectionExists() {
    const command = {
      _obj:"get",
      _target: {
        _ref: [{
          _property :"selection"
        }, {
          _ref: "document",
          _id: this.doc.id
        }]
      }
    };
    const result = await action.batchPlay([command], {});
    return result[0].hasOwnProperty("selection");
  }

  /** コマンドオブジェクトに自由変形の中心情報を追加する
   * @param {Object} command 対象のコマンドオブジェクト
   * @param {string} centerState 中心情報
   */
  #appendFreeTransformCenterState(command, centerState) {
    command.freeTransformCenterState = {
      _enum: "quadCenterState",
      _value: centerState
    };
  }

  /** コマンドオブジェクトに補間情報(バイキュービック)を追加する
   * @param {Object} command 対象のコマンドオブジェクト
  */
  #appendInterpolationType(command) {
    command.interfaceIconFrameDimmed = {
      _enum: "interpolationType",
      _value: "bicubic"
    }
  }

  /** 値を表すコマンドオブジェクトを生成
   * @param {number} value 値
   * @param {string} unit 単位
   */
  #generateValueCommand(value, unit="pixelsUnit") {
    return {
      _unit: unit,
      _value: value
    };
  }

  /** Apply translate
   * @param {number} distanceH
   * @param {number} distanceV
   */
  move (distanceH, distanceV) {
    // const isExistSelection = await this.isExistSelection();
    const command = {
      _obj: "cut",
      "to": {
        _obj: "offset",
        "horizontal": this.#generateValueCommand(distanceH),
        "vertical": this.#generateValueCommand(distanceV)
      },
      _target: MultiLayerTransform._TARGET_SELECTION
    };

    this.#execute(
      command,
      async () => {
        await this.#moveSelection(distanceH, distanceV);
      }
    );
  }

  /** 回転コマンドを生成
   * @param {number} angle
   * @param {string} centerState
   * @param {Object} target
   * @returns {Object} rotate command
   */
  #generateRotateCommand(angle, centerState, target) {
    const command = {
      _obj: "transform",
      "angle": {
        _unit: "angleUnit",
        _value: angle
      },
      _target: target
    };
    this.#appendFreeTransformCenterState(command, centerState);
    this.#appendInterpolationType(command);

    return command;
  }

  /** Apply rotate
   * @param {number} angle
   * @param {string} centerState
   */
  rotate (angle, centerState) {
    // 回転コマンドの生成
    const command = this.#generateRotateCommand(
      angle, centerState, MultiLayerTransform.#TARGET_LAYER);
    // 選択範囲リストア後に選択範囲を変形と同等に回転するコマンドを生成
    const afterRestoreSelectionCommand = this.#generateRotateCommand(
      angle, centerState, MultiLayerTransform._TARGET_SELECTION);
    // 実行
    this.#execute(
      command,
      async () => {
        await this.#execBatchPlay(afterRestoreSelectionCommand);
      }
    );
  }

  /** スケールコマンドを生成
   * @param {number} valueWidth
   * @param {number} valueHeight
   * @param {string} unit
   * @param {string} centerState
   * @param {Object} target
   * @returns {Object} scale command
  */
  #generateScaleCommand(valueWidth, valueHeight, unit, centerState, target) {
    const command = {
      _obj: "transform",
      width: this.#generateValueCommand(valueWidth, unit),
      height: this.#generateValueCommand(valueHeight, unit),
      _target: target
    };
    this.#appendFreeTransformCenterState(command, centerState);
    this.#appendInterpolationType(command);

    return command;
  }

  /** Apply scale
   * @param {number} valueWidth
   * @param {number} valueHeight
   * @param {string} unit
   * @param {string} centerState
   */
  scale(valueWidth, valueHeight, unit, centerState) {
    // スケールコマンドの生成
    const command = this.#generateScaleCommand(
      valueWidth, valueHeight, unit, centerState,
      MultiLayerTransform.#TARGET_LAYER);
    // 選択範囲リストア後に選択範囲を変形と同等にスケールするコマンドを生成
    const afterRestoreSelectionCommand = this.#generateScaleCommand(
      valueWidth, valueHeight, unit, centerState,
      MultiLayerTransform._TARGET_SELECTION);
    // 実行
    this.#execute(
      command,
      async () => {
        await this.#execBatchPlay(afterRestoreSelectionCommand);
      }
    );
  }

  /** コマンド実行
   * @param {Object} command
   * @param {Function} funcAfterRestoreSelection 選択範囲復元後に実行する関数
   */
  async #execute(command, funcAfterRestoreSelection = null)
  {
    // 選択レイヤーがない場合は処理を中断
    if (this.activeLayerIds.length == 0) {
      return;
    }

    // 選択範囲が存在するかどうかを取得
    var isExistSelection = await this.#isSelectionExists();

    // Execute as modal
    await core.executeAsModal(async (executionContext) => {
      // 一連の処理を一つのヒストリにまとめるため、ヒストリの記録をサスペンド
      const hostControl = executionContext.hostControl;
      const suspensionID = await hostControl.suspendHistory({
        "documentID": this.docId,
        "name": "[Plugin]SelectionTranslator"
      });

      if (!isExistSelection) {
        // 選択範囲がない場合は全選択
        await this.#selectionAll();
      }
      // 選択範囲を保存するレイヤーを作成し、選択範囲をマスクで保存
      let result = await this.#createNewLayer(this.tempSelectionLayerName);
      var tempLayerId = result[0].layerID;
      console.log(`tempLayerId ${tempLayerId}`);
      await this.#createLayerMaskFromSelection();

      for (const layer of this.targetLayers) {
        const layerID = layer.id;
        const isNormalLayer = layer.kind == constants.LayerKind.NORMAL;
        const hasUserMask = await this.#hasLayerMask(layerID);

        if (!isNormalLayer && !hasUserMask) {
          // 通常レイヤーではなくマスクもない場合はスキップ
          continue;
        }

        // 選択範囲を読み込み
        await this.#loadSelectionFromLayerMask(tempLayerId);

        // 対象レイヤー、またはレイヤーマスクの選択
        if (hasUserMask) {
          // レイヤーマスクが存在する場合はマスクを選択
          await this.#selectLayerMaskById(layerID);
        } else {
          // レイヤーマスクが存在しない場合はレイヤーを選択
          await this.#selectLayerById(layerID);
        }
        // 移動の実行
        await this.#execBatchPlay(command);
      }

      // 選択範囲をリストアし、選択範囲を保存したレイヤーを削除する
      if (isExistSelection) {
        // 選択範囲を復元
        await this.#loadSelectionFromLayerMask(tempLayerId);
        // 選択範囲の後処理（主に変形処理）
        if (funcAfterRestoreSelection) {
          await funcAfterRestoreSelection();
        }
      } else {
        // もともと選択範囲がなかった場合は選択を解除
        await this.#clearSelection();
      }
      await this.#deleteLayerById(tempLayerId);

      // レイヤーの選択状況をもとに戻す
      await this.#selectLayerById(this.activeLayerIds);

      // ヒストリの記録を再開
      await hostControl.resumeHistory(suspensionID);
    }, { "commandName": "In Progress..." });
  }

  /** Execute batchPlay command
   * @param {Object} command command object to batchPlay
   * @returns {Object} result of batchPlay
  */
  async #execBatchPlay(command) {
    return await action.batchPlay([command], {});
  }

  /** レイヤーマスクの有無を取得
   * @param {number} layerID
  */
  async #hasLayerMask(layerID) {
    const command = {
      _obj: "get",
      _target: [
      {
        _ref: "layer",
        _id: layerID
      }, {
        _ref: "document",
        _id: this.docId
      }]
    };

    const result = await this.#execBatchPlay(command);
    return result[0].hasUserMask;
  }

  /** 通常レイヤーを作成
   * @param {string} layerName
   * @returns created layer
   */
  async #createNewLayer(layerName="new Layer") {
    const command = {
      "_obj": "make",
      "_target": [{
        "_ref": "layer"
      }],
      "using": {
        "_obj":"layer",
        "name":layerName
      }
    };

    return await this.#execBatchPlay(command)
  }

  /** layerID(s) のレイヤーを選択
   * @param {number | number[]} layerID
   */
  async #selectLayerById(layerID) {
    // 1つ目のレイヤーとそれ以外のレイヤー配列に分ける
    let firstLayerId;
    let addLayerIds;
    if (!Array.isArray(layerID)) {
      firstLayerId = layerID;
      addLayerIds = [];
    }
    else {
      addLayerIds = layerID.slice(1);
      firstLayerId = layerID[0];
    }

    // 1つ目のレイヤーを選択
    const command = {
      _obj: "select",
      makeVisible: false,
      _target: [{
        _ref: "layer",
        _id: firstLayerId
      }]
    };
    await this.#execBatchPlay(command)

    // 2つ目以降のレイヤーを選択
    for (let i of addLayerIds) {
      const command = {
        _obj: "select",
        makeVisible: false,
        _target: [{
          _ref: "layer",
          _id: i
        }],
        selectionModifier: {
          _enum: "selectionModifierType",
          _value: "addToSelection"
        }
      };
      await this.#execBatchPlay(command)
    }
  }

  /** layerID のレイヤーマスクを選択
   * @param {number} layerID
   */
  async #selectLayerMaskById(layerID) {
    const command = {
      _obj:"select",
      "_target":[{
        _enum:"channel",
        _ref:"channel",
        _value:"mask"
      }, {
        _id: layerID,
        _ref: "layer"
      }],
      "makeVisible":false
    };

    await this.#execBatchPlay(command);
  }

  /** 選択しているレイヤーを削除 */
  async #deleteLayerActiveLayer() {
    const command = {
      "_obj":"delete",
      "_target":[{
        "_enum":"ordinal",
        "_ref":"layer",
        "_value":"targetEnum"
      }]
    };

    await this.#execBatchPlay(command)
  }

  /** layerID(s) のレイヤーを削除
   * @param {number | number[]} layerID
   */
  async #deleteLayerById(layerID) {
    await this.#selectLayerById(layerID);
    await this.#deleteLayerActiveLayer();
  }

  /** 選択範囲からレイヤーマスクを現在の選択レイヤーに作成 */
  async #createLayerMaskFromSelection() {
    const command = {
      _obj: "make",
      "at": {
        _enum: "channel",
        _ref: "channel",
        _value: "mask"
      },
      "new": {
        _class: "channel"
      },
      "using": {
        _enum: "userMaskEnabled",
        _value: "revealSelection"
      }
    };

    await this.#execBatchPlay(command);
  }

  /** layerID のレイヤーからレイヤーマスクを生成
   * @param {number} layerID
   */
  async #loadSelectionFromLayerMask(layerID) {
    const command = {
      _obj: "set",
      _target: [{
        _property: "selection",
        _ref: "channel"
      }],
      "to": {
        _ref: [{
          _enum: "channel",
          _ref: "channel",
          _value: "mask"
        }, {
          _id: layerID,
          _ref: "layer"
        }]
      }
    };

    await this.#execBatchPlay(command);
  }

  /** 全選択 */
  async #selectionAll() {
    await this.#selectionAllOrNothing(true);
  }

  /** 選択を解除 */
  async #clearSelection() {
    await this.#selectionAllOrNothing(false);
  }

  /** 引数の真偽値をもとに全選択または全解除
   * @param {boolean} isSelect
   */
  async #selectionAllOrNothing(isSelect=true) {
    const command = {
      _obj: "set",
      _target: [{
        _property:"selection",
        _ref:"channel"
      }],
      "to": {
        _enum:"ordinal",
        _value: isSelect ? "allEnum" : "none"
      }
    };

    await this.#execBatchPlay(command);
  }

  /** 選択範囲を移動
   * @param {number} distanceH
   * @param {number} distanceV
   */
  async #moveSelection(distanceH, distanceV) {
    const command = {
      _obj: "move",
      _target: [{
        _property: "selection",
        _ref: "channel"
      }],
      "to": {
        _obj: "offset",
        "horizontal": {
          _unit: "pixelsUnit",
          _value: distanceH
        },
        "vertical": {
          _unit: "pixelsUnit",
          _value: distanceV
        }
      }
    };

    await this.#execBatchPlay(command);
  }
}


// Setup EventListener ---------------------------------------------------------
// Move
document.querySelectorAll("sp-action-button.moveDirection").forEach(btn => {
  btn.addEventListener("click", () => {
    // UI から移動距離を取得
    const distance = Number(document.getElementById("moveValue").value);
    // 押されたボタンによって移動方向を決定
    let h, v;
    switch (btn.id) {
      case "btnMoveUp":
        h = 0;
        v = -distance;
        break;
      case "btnMoveDown":
        h = 0;
        v = distance;
        break;
      case "btnMoveLeft":
        h = -distance;
        v = 0;
        break;
      case "btnMoveRight":
        h = distance;
        v = 0;
        break;
    }
    // 移動処理
    new MultiLayerTransform().move(h, v);
  });
});

// Rotate
document.querySelectorAll("#btnRotateLeft, #btnRotateRight").forEach(btn => {
  btn.addEventListener("click", evt => {
    // UI から回転角度と中心点を取得
    const angle = document.getElementById("rotateValue").value * (btn.id == "btnRotateLeft" ? -1 : 1);
    const center = document.getElementById("rotateCenter").value;
    // 回転処理
    new MultiLayerTransform().rotate(angle, center);
  });
})
// set angle
document.querySelectorAll("sp-action-button.rotateAngleSwitch").forEach(btn => {
  btn.addEventListener("click", evt => {
    // 押されたボタンから回転角度を取得
    const angle = Number(evt.target.innerText);
    // スライダーに値をセット
    document.getElementById("rotateValue").value = angle;
  });
});
// togle angle nega-posi
document.getElementById("rotateAngleToggle").addEventListener("click", evt => {
  // 回転角度の符号を反転
  document.getElementById("rotateValue").value *= -1;
});

// Scale
document.getElementById("btnScaleApply").addEventListener("click", () => {
  // UI から縦横スケール値、単位、中心点を取得
  const width = Number(document.getElementById("scaleValueWidth").value);
  const height = Number(document.getElementById("scaleValueHeight").value);
  const unit = document.getElementById("dropScaleUnit").value;
  const center = document.getElementById("dropScaleCenter").value;
  // スケール処理
  new MultiLayerTransform().scale(width, height, unit, center);
});
