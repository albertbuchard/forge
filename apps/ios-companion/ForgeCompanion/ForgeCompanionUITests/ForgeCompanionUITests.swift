//
//  ForgeCompanionUITests.swift
//  ForgeCompanionUITests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest

final class ForgeCompanionUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = makeApp()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
    }

    @MainActor
    func testPairingSetupFlowPrioritizesForgeQRAndManualFallback() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "pairing"
        app.launch()

        XCTAssertTrue(app.staticTexts["Set up sync"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Choose your Forge connection."].exists)

        let scanButton = app.buttons["Scan Forge QR"]
        XCTAssertTrue(scanButton.waitForExistence(timeout: 8))
        XCTAssertTrue(scanButton.isHittable)

        let manualButton = app.buttons["Manual connection"]
        XCTAssertTrue(manualButton.waitForExistence(timeout: 2))
        XCTAssertTrue(manualButton.isHittable)

        scanButton.tap()

        XCTAssertTrue(app.staticTexts["Scan your Forge QR."].waitForExistence(timeout: 5))
        XCTAssertTrue(scrollUntilHittable(app.buttons["Open camera scanner"], in: app))
        XCTAssertTrue(scrollUntilHittable(app.buttons["Paste pairing payload"], in: app))
    }

    @MainActor
    func testWebExperienceKeepsNativeControlsOutOfTheWebCanvas() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launch()

        let controlBar = app.otherElements["ForgeNativeControlBar"]
        XCTAssertTrue(controlBar.waitForExistence(timeout: 8))
        let webRegionElements = app.descendants(matching: .any)
            .matching(identifier: "ForgeWebExperience")
        XCTAssertGreaterThan(webRegionElements.count, 0)
        let webExperience = try XCTUnwrap(
            webRegionElements.allElementsBoundByIndex.max {
                $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height
            }
        )
        XCTAssertLessThanOrEqual(
            controlBar.frame.maxY,
            webExperience.frame.minY + 1,
            "Native controls must reserve their own layout row instead of covering Forge web content."
        )

        XCTAssertTrue(app.buttons["Reload Forge web experience"].isHittable)
        XCTAssertTrue(app.buttons["Sync Forge now"].isHittable)
        XCTAssertTrue(app.buttons["Open Companion settings"].isHittable)
        attachScreenshot(named: "Forge web with reserved native controls")

        app.buttons["Open Companion control center"].tap()

        XCTAssertTrue(app.navigationBars["Companion"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["CompanionControlCenterSyncButton"].exists)
        XCTAssertTrue(scrollUntilHittable(app.buttons["Settings"], in: app))
        app.buttons["Settings"].tap()

        XCTAssertTrue(app.staticTexts["Companion status"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Done"].isHittable)
    }

    @MainActor
    func testWatchHandoffNavigatesTheExistingPairedForgeExperience() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_WATCH_HANDOFF_URL"] =
            "forge-iroh://fakednodeid/forge/goals/goal-ui-test"
        app.launchArguments.append("--forge-ui-test-watch-handoff")
        app.launch()

        let webExperience = try largestWebExperience(in: app)
        XCTAssertEqual(
            XCTWaiter.wait(
                for: [
                    XCTNSPredicateExpectation(
                        predicate: NSPredicate(format: "value == %@", "/forge/goals/goal-ui-test"),
                        object: webExperience
                    )
                ],
                timeout: 8
            ),
            .completed
        )
        XCTAssertEqual(webExperience.value as? String, "/forge/goals/goal-ui-test")
        XCTAssertTrue(app.buttons["Open Companion control center"].isHittable)
    }

    @MainActor
    func testWatchHandoffCannotReplaceThePairedForgeOrigin() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_WATCH_HANDOFF_URL"] =
            "https://external.example/forge/goals/goal-ui-test"
        app.launchArguments.append("--forge-ui-test-watch-handoff")
        app.launch()

        let webExperience = try largestWebExperience(in: app)
        let activePath = try XCTUnwrap(webExperience.value as? String)
        XCTAssertTrue(["/forge", "/forge/"].contains(activePath))
        XCTAssertNotEqual(activePath, "/forge/goals/goal-ui-test")
    }

    @MainActor
    func testPeerScanOpensReviewBeforeAnyVerificationOrAction() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_PEER_REVIEW_STATE"] = "scanned"
        app.launch()

        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.otherElements["PeerPairingReview"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["PeerScanNoActionNotice"].exists)
        XCTAssertTrue(app.staticTexts["PeerFingerprint"].exists)
        XCTAssertTrue(app.buttons["PeerContinueReviewButton"].isHittable)
        XCTAssertFalse(app.staticTexts["PeerVerificationPhrase"].exists)
        XCTAssertFalse(app.buttons["PeerConfirmRelationshipButton"].exists)
        XCTAssertFalse(app.staticTexts[String(repeating: "B", count: 48)].exists)
        XCTAssertFalse(app.staticTexts[String(repeating: "S", count: 86)].exists)
        attachScreenshot(named: "Peer review before action")
    }

    @MainActor
    func testPeerVerifiedReviewRequiresSeparateIdentityConfirmation() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_PEER_REVIEW_STATE"] = "verified"
        app.launch()

        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["PeerVerificationPhrase"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["PeerVerificationPhrase"].label, "violet harbor seven")
        XCTAssertEqual(app.staticTexts["PeerFingerprint"].label, "ABCD-EFGH-JKLM-NPQR")
        XCTAssertTrue(app.staticTexts["calendar.availability.v1"].exists)
        XCTAssertTrue(app.staticTexts["startsAt"].exists)

        let confirm = app.descendants(matching: .any)["PeerConfirmRelationshipButton"]
        for _ in 0..<3 where confirm.exists == false {
            app.swipeUp()
        }
        XCTAssertTrue(confirm.exists)
        XCTAssertFalse(confirm.isEnabled)
        let identityToggle = app.descendants(matching: .any)["PeerIdentityConfirmedToggle"]
        XCTAssertTrue(identityToggle.exists)
        identityToggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(
            XCTWaiter.wait(
                for: [
                    XCTNSPredicateExpectation(
                        predicate: NSPredicate(format: "value == '1'"),
                        object: identityToggle
                    )
                ],
                timeout: 3
            ),
            .completed
        )
        let enabledConfirm = app.descendants(matching: .any)["PeerConfirmRelationshipButton"]
        XCTAssertEqual(
            XCTWaiter.wait(
                for: [
                    XCTNSPredicateExpectation(
                        predicate: NSPredicate(format: "isEnabled == true"),
                        object: enabledConfirm
                    )
                ],
                timeout: 3
            ),
            .completed
        )
        attachScreenshot(named: "Peer verified review with redacted consent")
    }

    @MainActor
    func testPeerScannerExplainsCameraDenialWithoutFallbackAcceptance() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_PEER_CAMERA_AUTH"] = "denied"
        app.launch()

        app.buttons["Open Companion control center"].tap()
        XCTAssertTrue(app.navigationBars["Companion"].waitForExistence(timeout: 5))
        XCTAssertTrue(scrollUntilHittable(app.buttons["People"], in: app))
        app.buttons["People"].tap()
        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 5))

        app.buttons["PeerScanButton"].tap()
        XCTAssertTrue(app.staticTexts["Camera access is off"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["PeerCameraDenied"].exists)
        XCTAssertFalse(app.buttons["Continue review"].exists)
        let close = app.buttons["PeerScannerCloseButton"]
        XCTAssertTrue(close.exists)
        XCTAssertTrue(close.isHittable)
        XCTAssertGreaterThanOrEqual(close.frame.width, 44)
        XCTAssertGreaterThanOrEqual(close.frame.height, 44)
    }

    @MainActor
    func testPeerReviewFitsNarrowAccessibilityLayoutWithVoiceOverLabels() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_PEER_REVIEW_STATE"] = "verified"
        app.launchArguments.append(contentsOf: [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge"
        ])
        app.launch()

        XCTAssertLessThan(app.frame.width, 500)
        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 8))
        let review = app.otherElements["PeerPairingReview"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        let fingerprint = app.staticTexts["PeerFingerprint"]
        let phrase = app.staticTexts["PeerVerificationPhrase"]
        XCTAssertTrue(fingerprint.exists)
        XCTAssertTrue(phrase.exists)
        XCTAssertGreaterThanOrEqual(fingerprint.frame.minX, app.frame.minX)
        XCTAssertLessThanOrEqual(fingerprint.frame.maxX, app.frame.maxX + 1)
        XCTAssertGreaterThanOrEqual(phrase.frame.minX, app.frame.minX)
        XCTAssertLessThanOrEqual(phrase.frame.maxX, app.frame.maxX + 1)

        let identityToggle = app.descendants(matching: .any)["PeerIdentityConfirmedToggle"]
        for _ in 0..<4 where identityToggle.exists == false {
            app.swipeUp()
        }
        XCTAssertTrue(identityToggle.exists)
        XCTAssertEqual(
            identityToggle.label,
            "I verified the identity through a separate channel"
        )
        let confirm = app.descendants(matching: .any)["PeerConfirmRelationshipButton"]
        for _ in 0..<4 where confirm.exists == false {
            app.swipeUp()
        }
        XCTAssertTrue(confirm.exists)
        XCTAssertEqual(confirm.label, "Confirm relationship")
        XCTAssertLessThanOrEqual(confirm.frame.maxX, app.frame.maxX + 1)
        XCTAssertFalse(app.staticTexts[String(repeating: "B", count: 48)].exists)
        XCTAssertFalse(app.staticTexts[String(repeating: "S", count: 86)].exists)
        attachScreenshot(named: "Peer review accessibility layout")
    }

    @MainActor
    func testPeopleWatchUnpinnedPersonOffersDeliberateAccessibleSelectionOnIPhone() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_PEOPLE_WATCH_PIN_STATE"] = "unpinned"
        app.launchArguments.append(contentsOf: [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge"
        ])
        app.launch()

        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 8))
        let relationship = app.staticTexts["Ada's Forge"]
        XCTAssertTrue(relationship.waitForExistence(timeout: 5))
        relationship.tap()
        XCTAssertTrue(app.navigationBars["Ada's Forge"].waitForExistence(timeout: 5))

        let pin = app.buttons["PeopleWatchPinButton"]
        XCTAssertTrue(scrollUntilHittable(pin, in: app))
        XCTAssertEqual(pin.label, "Show on Apple Watch")
        XCTAssertGreaterThanOrEqual(pin.frame.width, 44)
        XCTAssertGreaterThanOrEqual(pin.frame.height, 44)
        XCTAssertLessThanOrEqual(pin.frame.maxX, app.frame.maxX + 1)
        XCTAssertFalse(app.buttons["PeopleWatchUnpinButton"].exists)
        attachScreenshot(named: "People Watch unpinned accessible selection")
    }

    @MainActor
    func testPeopleWatchPinnedPersonRequiresExplicitRemovalConfirmation() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_PEOPLE_WATCH_PIN_STATE"] = "pinned"
        app.launch()

        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 8))
        let relationship = app.staticTexts["Ada's Forge"]
        XCTAssertTrue(relationship.waitForExistence(timeout: 5))
        relationship.tap()
        XCTAssertTrue(app.navigationBars["Ada's Forge"].waitForExistence(timeout: 5))

        let unpin = app.buttons["PeopleWatchUnpinButton"]
        XCTAssertTrue(scrollUntilHittable(unpin, in: app))
        XCTAssertEqual(unpin.label, "Remove from Apple Watch")
        XCTAssertGreaterThanOrEqual(unpin.frame.width, 44)
        XCTAssertGreaterThanOrEqual(unpin.frame.height, 44)
        unpin.tap()

        XCTAssertTrue(app.staticTexts["Remove this Person from Apple Watch?"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Remove Person pin"].exists)
        XCTAssertFalse(app.buttons["PeopleWatchPinButton"].exists)
    }

    @MainActor
    func testPeopleIPhoneExposesGrantReviewAndBoundedResyncControls() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "home"
        app.launchEnvironment["FORGE_UI_TEST_PEOPLE_WATCH_PIN_STATE"] = "unpinned"
        app.launch()

        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 8))
        let relationship = app.staticTexts["Ada's Forge"]
        XCTAssertTrue(relationship.waitForExistence(timeout: 5))
        relationship.tap()
        XCTAssertTrue(app.navigationBars["Ada's Forge"].waitForExistence(timeout: 5))

        let resync = app.buttons["PeerResyncButton"]
        XCTAssertTrue(scrollUntilHittable(resync, in: app))
        XCTAssertTrue(resync.isEnabled)
        XCTAssertEqual(resync.label, "Resync shared data")

        let grantsTab = app.segmentedControls.buttons["Grants"]
        XCTAssertTrue(grantsTab.waitForExistence(timeout: 3))
        grantsTab.tap()

        let newGrant = app.buttons["PeerNewGrantButton"]
        XCTAssertTrue(newGrant.waitForExistence(timeout: 3))
        XCTAssertTrue(newGrant.isEnabled)
        XCTAssertTrue(app.buttons["PeerGrantAcceptButton"].exists)
        XCTAssertTrue(app.buttons["PeerGrantAcceptButton"].isEnabled)
        XCTAssertTrue(app.buttons["PeerGrantCounterButton"].exists)
        XCTAssertTrue(app.buttons["PeerGrantCounterButton"].isEnabled)

        newGrant.tap()
        XCTAssertTrue(app.navigationBars["New grant"].waitForExistence(timeout: 3))
        let preview = app.buttons["PeerGrantPreviewButton"]
        XCTAssertTrue(scrollUntilHittable(preview, in: app))
        XCTAssertTrue(preview.isEnabled)
        XCTAssertEqual(preview.label, "Preview exact grant")
        attachScreenshot(named: "People iPhone grant review controls")
    }

    @MainActor
    func testMovementTimelineSelectedActionButtonsAreTappable() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "life-timeline"
        app.launch()

        XCTAssertTrue(app.staticTexts["Life Timeline"].waitForExistence(timeout: 8))
        attachScreenshot(named: "Life Timeline initial state")

        let segmentButtons = app.buttons.matching(identifier: "MovementTimelineStaySegmentButton")
        XCTAssertTrue(segmentButtons.firstMatch.waitForExistence(timeout: 8))
        XCTAssertTrue(tapFirstHittable(in: segmentButtons), "No hittable movement timeline segment was available.")

        let labelButton = app.buttons["MovementTimelineInlineLabelLocationButton"]
        if labelButton.waitForExistence(timeout: 5) == false {
            XCTFail("Inline label button did not appear after selecting a stay.\n\(app.debugDescription)")
        }
        XCTAssertTrue(labelButton.isHittable)
        labelButton.tap()

        XCTAssertTrue(app.navigationBars["Set Location Label"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()

        let detailsButton = app.buttons["MovementTimelineInlineDetailsButton"]
        XCTAssertTrue(detailsButton.waitForExistence(timeout: 5))
        XCTAssertTrue(detailsButton.isHittable)
        detailsButton.tap()

        let sheetLabelButton = app.buttons["MovementTimelineDetailSheetLabelLocationButton"]
        XCTAssertTrue(sheetLabelButton.waitForExistence(timeout: 5))
        XCTAssertTrue(
            scrollUntilHittable(sheetLabelButton, in: app),
            "Detail-sheet label action was not reachable.\n\(app.debugDescription)"
        )
        sheetLabelButton.tap()

        XCTAssertTrue(app.navigationBars["Set Location Label"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            makeApp().launch()
        }
    }

    private func makeApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FORGE_COMPANION_DISABLE_SIMULATOR_AUTOMATION"] = "1"
        return app
    }

    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func largestWebExperience(in app: XCUIApplication) throws -> XCUIElement {
        let candidates = app.descendants(matching: .any)
            .matching(identifier: "ForgeWebExperience")
        XCTAssertTrue(candidates.firstMatch.waitForExistence(timeout: 8))
        return try XCTUnwrap(
            candidates.allElementsBoundByIndex.max {
                $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height
            }
        )
    }

    private func scrollUntilHittable(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        for _ in 0..<8 {
            if element.waitForExistence(timeout: 0.5), element.isHittable {
                return true
            }
            app.swipeUp()
        }
        return element.waitForExistence(timeout: 0.5) && element.isHittable
    }

    private func tapFirstHittable(in query: XCUIElementQuery) -> Bool {
        for index in 0..<min(query.count, 12) {
            let element = query.element(boundBy: index)
            if element.exists,
               element.isHittable,
               element.frame.midY > 140,
               element.frame.midY < 820
            {
                element.tap()
                return true
            }
        }
        return false
    }
}
